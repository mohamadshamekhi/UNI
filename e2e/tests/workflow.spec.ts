import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";
import { ADMIN, BACKOFFICE, PNG, TENANT, uniqueMobile, WEB } from "./support";

const API = process.env.E2E_API_URL ?? "http://localhost:4000";

/**
 * Phase 2 acceptance gate: one sample workflow runs end to end (portal → cartable → revision →
 * decision), a running case stays on its version when a new one is published, and the
 * applicant is notified.
 */
test.describe.serial("workflow journey (phase 2 gate)", () => {
  const stamp = Date.now().toString(36);
  const requestType = `e2e_${stamp}`;
  const student = { mobile: uniqueMobile(), password: "Student#E2e2026" };
  let api: APIRequestContext;
  let adminToken = "";
  let workflowId = "";
  let caseId = "";

  const as = (token: string) => ({ authorization: `Bearer ${token}`, "x-tenant": TENANT });
  const json = async <T>(p: Promise<{ ok(): boolean; json(): Promise<unknown>; text(): Promise<string>; url(): string }>): Promise<T> => {
    const r = await p;
    if (!r.ok()) throw new Error(`${r.url()} → ${await r.text()}`);
    return (await r.json()) as T;
  };
  const login = async (identifier: string, password: string) =>
    (await json<{ accessToken: string }>(api.post(`${API}/v1/auth/login`, { data: { identifier, password } }))).accessToken;

  async function signIn(page: Page, base: string, mobile: string, password: string) {
    await page.goto(base === WEB ? `${WEB}/${TENANT}/login` : `${BACKOFFICE}/login`);
    await page.getByRole("textbox", { name: "شماره موبایل یا ایمیل", exact: true }).fill(mobile);
    await page.getByRole("textbox", { name: "رمز عبور", exact: true }).fill(password);
    await page.getByRole("button", { name: "ورود", exact: true }).click();
    await page.waitForURL((u) => !u.pathname.endsWith("/login"));
  }

  test.beforeAll(async () => {
    api = await request.newContext();
    adminToken = await login(ADMIN.mobile, ADMIN.password);

    // workflow from the built-in template, assigned to the university admin role for this test
    const w = await json<{ id: string }>(
      api.post(`${API}/v1/admin/workflow-templates/general-request/instantiate`, {
        headers: as(adminToken),
        data: { key: `e2e-${stamp}`, nameFa: `درخواست آزمایشی ${stamp}`, requestType },
      }),
    );
    workflowId = w.id;
    const detail = await json<{ versions: { id: string }[] }>(api.get(`${API}/v1/admin/workflows/${w.id}`, { headers: as(adminToken) }));
    const v1 = await json<{ definition: { steps: { id: string; assignee?: unknown }[] } }>(api.get(`${API}/v1/admin/workflow-versions/${detail.versions[0]!.id}`, { headers: as(adminToken) }));
    v1.definition.steps[0]!.assignee = { role: "university_admin", scope: "tenant" };
    await json(api.patch(`${API}/v1/admin/workflow-versions/${detail.versions[0]!.id}`, { headers: as(adminToken), data: { definition: v1.definition } }));
    expect((await json<{ ok: boolean }>(api.post(`${API}/v1/admin/workflow-versions/${detail.versions[0]!.id}/validate`, { headers: as(adminToken) }))).ok).toBe(true);
    await json(api.post(`${API}/v1/admin/workflow-versions/${detail.versions[0]!.id}/publish`, { headers: as(adminToken) }));

    // an approved student (OTP code is echoed by the dev API)
    const units = await json<{ id: string }[]>(api.get(`${API}/v1/public/units`, { headers: { "x-tenant": TENANT } }));
    const otp = await json<{ devCode: string }>(api.post(`${API}/v1/auth/otp/request`, { headers: { "x-tenant": TENANT }, data: { mobile: student.mobile, purpose: "register" } }));
    const { proof } = await json<{ proof: string }>(api.post(`${API}/v1/auth/otp/verify`, { data: { mobile: student.mobile, purpose: "register", code: otp.devCode } }));
    const file = await json<{ id: string }>(
      api.post(`${API}/v1/files`, {
        headers: { "x-tenant": TENANT, "x-mobile-proof": proof },
        multipart: { purpose: "membership_document", file: { name: "card.png", mimeType: "image/png", buffer: PNG } },
      }),
    );
    const reg = await json<{ membershipId: string }>(
      api.post(`${API}/v1/registrations`, {
        headers: { "x-tenant": TENANT },
        data: {
          mobileProof: proof,
          kind: "student",
          unitId: units[0]!.id,
          memberNo: `e2e${stamp}`,
          fullName: "دانشجوی گردش‌کار",
          password: student.password,
          profile: { degree: "msc" },
          documentFileIds: [file.id],
          acceptTerms: true,
        },
      }),
    );
    await json(api.post(`${API}/v1/admin/memberships/${reg.membershipId}/approve`, { headers: as(adminToken), data: {} }));
  });

  test.afterAll(() => api.dispose());

  test("student files a request from the portal", async ({ page }) => {
    await signIn(page, WEB, student.mobile, student.password);
    await page.goto(`${WEB}/${TENANT}/cases/new`);
    await page.getByText(`درخواست آزمایشی ${stamp}`).click();
    await page.getByRole("textbox", { name: "عنوان", exact: true }).fill("گواهی برای بورسیه");
    await page.getByRole("textbox", { name: "موضوع", exact: true }).fill("گواهی اشتغال به تحصیل");
    await page.getByRole("textbox", { name: "شرح درخواست", exact: true }).fill("برای ارائه به بنیاد نخبگان");
    await page.getByRole("button", { name: "ثبت و ارسال" }).click();
    await page.waitForURL(/\/cases\/[0-9a-f-]{36}/);
    caseId = page.url().match(/cases\/([0-9a-f-]{36})/)![1]!;
    await expect(page.getByText("درخواست شما ثبت و برای بررسی ارجاع شد.")).toBeVisible();
    await expect(page.getByText("بررسی کارشناس").first()).toBeVisible();
  });

  test("the case reaches the cartable; reviewer returns it for revision", async ({ page }) => {
    await signIn(page, BACKOFFICE, ADMIN.mobile, ADMIN.password);
    await page.goto(`${BACKOFFICE}/t/${TENANT}/tasks`);
    await page.locator(`a[href="/t/${TENANT}/cases/${caseId}"]`).first().click();
    await expect(page.getByRole("heading", { name: "گواهی برای بورسیه" })).toBeVisible();
    await page.getByRole("textbox", { name: "پیام به متقاضی", exact: true }).fill("نام بنیاد را کامل بنویسید.");
    await page.getByRole("button", { name: "بازگشت برای اصلاح" }).click();
    await expect(page.getByText("نیازمند اصلاح").first()).toBeVisible();
  });

  test("student revises and resubmits", async ({ page }) => {
    await signIn(page, WEB, student.mobile, student.password);
    await page.goto(`${WEB}/${TENANT}/cases/${caseId}`);
    await expect(page.getByText("نام بنیاد را کامل بنویسید.").first()).toBeVisible();
    await page.getByRole("textbox", { name: "شرح درخواست", exact: true }).fill("برای ارائه به بنیاد ملی نخبگان");
    await page.getByRole("button", { name: "ارسال اصلاحیه" }).click();
    await expect(page.getByText("در جریان").first()).toBeVisible();
  });

  test("a new version does not move the running case; approval closes it and notifies", async ({ page }) => {
    // v2 renames the review step; the running case must keep v1's title
    const v2 = await json<{ id: string; definition: { steps: { title: string }[] } }>(
      api.post(`${API}/v1/admin/workflows/${workflowId}/versions`, { headers: as(adminToken), data: {} }),
    );
    const full = await json<{ definition: { steps: { title: string }[] } }>(api.get(`${API}/v1/admin/workflow-versions/${v2.id}`, { headers: as(adminToken) }));
    full.definition.steps[0]!.title = "بررسی کارشناس (نسخه ۲)";
    await json(api.patch(`${API}/v1/admin/workflow-versions/${v2.id}`, { headers: as(adminToken), data: { definition: full.definition } }));
    await json(api.post(`${API}/v1/admin/workflow-versions/${v2.id}/validate`, { headers: as(adminToken) }));
    await json(api.post(`${API}/v1/admin/workflow-versions/${v2.id}/publish`, { headers: as(adminToken) }));

    await signIn(page, BACKOFFICE, ADMIN.mobile, ADMIN.password);
    await page.goto(`${BACKOFFICE}/t/${TENANT}/cases/${caseId}`);
    await expect(page.getByRole("heading", { name: "بررسی کارشناس", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "تأیید", exact: true }).click();
    await expect(page.getByText("تأییدشده").first()).toBeVisible();

    await signIn(page, WEB, student.mobile, student.password);
    // the outbox poller dispatches within seconds
    await expect(async () => {
      await page.goto(`${WEB}/${TENANT}/notifications`);
      await expect(page.getByText(`پرونده ${caseId.slice(0, 8).toUpperCase()} تأیید شد`).first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
  });
});
