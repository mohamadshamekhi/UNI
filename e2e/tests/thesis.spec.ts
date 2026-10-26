import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";
import { ADMIN, API, apiLogin, approvedStudent, asTenant, BACKOFFICE, facultyMember, ok, PNG, TENANT, WEB } from "./support";

/**
 * Phase 3 gate: a thesis goes from definition to recorded grade without the technical team —
 * template, draft, advisor choice, approvals, defense scheduling, grade, academic record.
 */
test.describe.serial("thesis journey (phase 3 gate)", () => {
  const stamp = Date.now().toString(36);
  const requestType = `thesis_${stamp}`;
  const workflowName = `پایان‌نامه آزمایشی ${stamp}`;
  let api: APIRequestContext;
  let adminToken = "";
  let student = { mobile: "", password: "Student#E2e2026", membershipId: "" };
  let advisor = { mobile: "", password: "Advisor#E2e2026", membershipId: "" };
  let reviewer = { mobile: "", password: "Reviewer#E2e2026", membershipId: "" };
  let caseId = "";

  async function signIn(page: Page, base: string, mobile: string, password: string) {
    await page.goto(base === WEB ? `${WEB}/${TENANT}/login` : `${BACKOFFICE}/login`);
    await page.getByRole("textbox", { name: "شماره موبایل یا ایمیل", exact: true }).fill(mobile);
    await page.getByRole("textbox", { name: "رمز عبور", exact: true }).fill(password);
    await page.getByRole("button", { name: "ورود", exact: true }).click();
    await page.waitForURL((u) => !u.pathname.endsWith("/login"));
  }
  async function act(page: Page, action: string) {
    await page.goto(`${BACKOFFICE}/t/${TENANT}/cases/${caseId}`);
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect(page.getByText(`اقدام «${action}» ثبت شد.`)).toBeVisible();
  }

  test.beforeAll(async () => {
    api = await request.newContext();
    adminToken = await apiLogin(api, ADMIN.mobile, ADMIN.password);
    // the template as a university would use it; review steps go to the university admin here
    const w = await ok<{ id: string }>(
      api.post(`${API}/v1/admin/workflow-templates/thesis-full/instantiate`, { headers: asTenant(adminToken), data: { key: `thesis-${stamp}`, nameFa: workflowName, requestType } }),
    );
    const vId = (await ok<{ versions: { id: string }[] }>(api.get(`${API}/v1/admin/workflows/${w.id}`, { headers: asTenant(adminToken) }))).versions[0]!.id;
    const v = await ok<{ definition: { steps: { assignee?: { role?: string; scope?: string } }[] } }>(api.get(`${API}/v1/admin/workflow-versions/${vId}`, { headers: asTenant(adminToken) }));
    for (const s of v.definition.steps) if (s.assignee?.role === "expert") s.assignee = { role: "university_admin", scope: "tenant" };
    await ok(api.patch(`${API}/v1/admin/workflow-versions/${vId}`, { headers: asTenant(adminToken), data: { definition: v.definition } }));
    expect((await ok<{ ok: boolean }>(api.post(`${API}/v1/admin/workflow-versions/${vId}/validate`, { headers: asTenant(adminToken) }))).ok).toBe(true);
    await ok(api.post(`${API}/v1/admin/workflow-versions/${vId}/publish`, { headers: asTenant(adminToken) }));

    student = await approvedStudent(api, adminToken, student.password, "دانشجوی پایان‌نامه");
    advisor = await facultyMember(api, adminToken, advisor.password, `استاد راهنما ${stamp}`);
    reviewer = await facultyMember(api, adminToken, reviewer.password, `داور ${stamp}`);
  });
  test.afterAll(() => api.dispose());

  test("student saves a proposal draft, then submits it", async ({ page }) => {
    await signIn(page, WEB, student.mobile, student.password);
    await page.goto(`${WEB}/${TENANT}/cases/new`);
    await page.getByText(workflowName).click();
    await page.getByRole("textbox", { name: "عنوان", exact: true }).fill("پیشنهاده یادگیری فدرال");
    await page.getByRole("textbox", { name: "عنوان فارسی", exact: true }).fill("یادگیری فدرال در شبکه‌های بیمارستانی");
    await page.getByRole("combobox", { name: "مقطع", exact: true }).selectOption("msc");
    await page.getByRole("button", { name: "ذخیره پیش‌نویس" }).click();
    await page.waitForURL(/\/cases\/[0-9a-f-]{36}$/);
    caseId = page.url().match(/cases\/([0-9a-f-]{36})/)![1]!;
    await expect(page.getByText("تکمیل پیش‌نویس")).toBeVisible();

    await page.getByRole("textbox", { name: "رشته / گرایش", exact: true }).fill("هوش مصنوعی");
    await page.getByRole("combobox", { name: "نوع پژوهش", exact: true }).selectOption("applied");
    await page.getByRole("textbox", { name: "چکیده", exact: true }).fill("حفظ حریم خصوصی داده‌های بیماران با یادگیری فدرال.");
    await page.getByRole("combobox", { name: "استاد راهنما", exact: true }).selectOption(advisor.membershipId);
    await page.locator('input[type="file"]').first().setInputFiles({ name: "proposal.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByText("proposal.png")).toBeVisible();
    await page.getByRole("button", { name: "ارسال درخواست" }).click();
    await expect(page.getByText("درخواست شما ثبت و برای بررسی ارجاع شد.")).toBeVisible();
    await expect(page.getByRole("list", { name: "مراحل پرونده" })).toBeVisible();
  });

  test("expert, advisor and graduate office approve the proposal", async ({ page }) => {
    await signIn(page, BACKOFFICE, ADMIN.mobile, ADMIN.password);
    await act(page, "تأیید");
    await signIn(page, BACKOFFICE, advisor.mobile, advisor.password);
    await page.goto(`${BACKOFFICE}/t/${TENANT}/tasks`);
    await expect(page.getByText("پذیرش استاد راهنما").first()).toBeVisible();
    await act(page, "تأیید");
    await signIn(page, BACKOFFICE, ADMIN.mobile, ADMIN.password);
    await act(page, "تأیید");
    await page.reload();
    await expect(page.getByRole("heading", { name: "تعیین داوران و جلسه دفاع", exact: true })).toBeVisible();
  });

  test("defense is scheduled with a reviewer and the grade recorded", async ({ page }) => {
    await signIn(page, BACKOFFICE, ADMIN.mobile, ADMIN.password);
    await page.goto(`${BACKOFFICE}/t/${TENANT}/cases/${caseId}`);
    await page.getByRole("checkbox", { name: `داور ${stamp}` }).check();
    await page.getByRole("textbox", { name: "محل برگزاری", exact: true }).fill("تالار شهید چمران");
    await page.getByRole("button", { name: "تعیین جلسه دفاع", exact: true }).click();
    await expect(page.getByText("اقدام «تعیین جلسه دفاع» ثبت شد.")).toBeVisible();
    await page.reload();
    await page.getByRole("spinbutton", { name: "نمره (از ۲۰)", exact: true }).fill("18.5");
    await page.getByRole("button", { name: "قبول", exact: true }).click();
    await expect(page.getByText("اقدام «قبول» ثبت شد.")).toBeVisible();
  });

  test("the academic record shows the defended thesis and grade", async ({ page }) => {
    await signIn(page, WEB, student.mobile, student.password);
    // the record is synced by the outbox poller within seconds
    await expect(async () => {
      await page.goto(`${WEB}/${TENANT}/thesis`);
      await expect(page.getByText("دفاع‌شده").first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(page.getByText("یادگیری فدرال در شبکه‌های بیمارستانی")).toBeVisible();
    await expect(page.getByText("بسیار خوب")).toBeVisible();
    await expect(page.getByText(`استاد راهنما ${stamp}`)).toBeVisible();
    await expect(page.getByText("تالار شهید چمران")).toBeVisible();

    // the advisor sees the supervision
    await signIn(page, BACKOFFICE, advisor.mobile, advisor.password);
    await page.goto(`${BACKOFFICE}/t/${TENANT}/supervisions`);
    await expect(page.getByText("یادگیری فدرال در شبکه‌های بیمارستانی")).toBeVisible();
  });
});
