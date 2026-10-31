import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";
import { ADMIN, API, apiLogin, approvedStudent, asTenant, BACKOFFICE, ok, TENANT, WEB } from "./support";

/**
 * Phase 6 gate: a paid event registration goes through the sandbox bank once — a repeated return
 * from the bank creates no second transaction or receipt — and finance sees it reconciled.
 */
test.describe.serial("paid event and reconciliation (phase 6 gate)", () => {
  const stamp = Date.now().toString(36);
  const eventTitle = `دوره پیشرفته پایتون ${stamp}`;
  let api: APIRequestContext;
  let adminToken = "";
  let payer = { mobile: "", password: "Payer#E2e2026", membershipId: "" };
  let eventId = "";
  let paymentId = "";
  let returnUrl = "";

  async function signIn(page: Page, base: string, mobile: string, password: string) {
    await page.goto(base === WEB ? `${WEB}/${TENANT}/login` : `${BACKOFFICE}/login`);
    await page.getByRole("textbox", { name: "شماره موبایل یا ایمیل", exact: true }).fill(mobile);
    await page.getByRole("textbox", { name: "رمز عبور", exact: true }).fill(password);
    await page.getByRole("button", { name: "ورود", exact: true }).click();
    await page.waitForURL((u) => !u.pathname.endsWith("/login"));
  }

  test.beforeAll(async () => {
    api = await request.newContext();
    adminToken = await apiLogin(api, ADMIN.mobile, ADMIN.password);
    payer = await approvedStudent(api, adminToken, payer.password, `پرداخت‌کننده ${stamp}`);
    const start = new Date(Date.now() + 6 * 86_400_000);
    const e = await ok<{ id: string }>(
      api.post(`${API}/v1/admin/events`, {
        headers: asTenant(adminToken),
        data: { title: eventTitle, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 7_200_000).toISOString(), visibility: "own_tenant", registrationRule: { members: true }, capacity: 20, feeAmount: 3_500_000 },
      }),
    );
    eventId = e.id;
    await ok(api.post(`${API}/v1/admin/events/${eventId}/status`, { headers: asTenant(adminToken), data: { status: "registration_open" } }));
  });
  test.afterAll(() => api.dispose());

  test("the member registers and is sent to pay the server-side amount", async ({ page }) => {
    await signIn(page, WEB, payer.mobile, payer.password);
    await page.goto(`${WEB}/${TENANT}/events/${eventId}`);
    await expect(page.getByText("۳٬۵۰۰٬۰۰۰ ریال").first()).toBeVisible();
    await page.getByRole("button", { name: /ثبت‌نام و پرداخت/ }).click();
    await page.waitForURL(/\/payments\/[0-9a-f-]{36}$/);
    paymentId = page.url().match(/payments\/([0-9a-f-]{36})/)![1]!;
    await expect(page.getByText("منتظر پرداخت")).toBeVisible();
    await expect(page.getByText("اطلاعات کارت فقط در صفحه بانک وارد می‌شود")).toBeVisible();
  });

  test("the sandbox bank approves; the return page shows the verified result and receipt", async ({ page }) => {
    await signIn(page, WEB, payer.mobile, payer.password);
    await page.goto(`${WEB}/${TENANT}/payments/${paymentId}`);
    await page.getByRole("button", { name: "پرداخت آنلاین" }).click();
    await page.waitForURL(/payment-sandbox\/SBX/);
    await expect(page.getByText("درگاه پرداخت آزمایشی")).toBeVisible();
    // the API's PORTAL_URL may point at another dev port: follow the bank's redirect by hand
    const [res] = await Promise.all([page.waitForResponse((r) => r.url().includes("/decide?outcome=success")), page.getByRole("link", { name: "پرداخت موفق" }).click()]);
    const location = (await res.allHeaders())["location"]!;
    returnUrl = location.replace(/^https?:\/\/[^/]+/, WEB);
    await page.goto(returnUrl);
    await expect(page.getByText("پرداخت با موفقیت انجام شد")).toBeVisible();
    // returning twice (refresh, a repeated bank callback) changes nothing
    await page.goto(returnUrl);
    await expect(page.getByText("پرداخت با موفقیت انجام شد")).toBeVisible();
    await page.getByRole("link", { name: "مشاهده رسید" }).click();
    await expect(page.getByRole("heading", { name: "رسید پرداخت" })).toBeVisible();
    await expect(page.getByText(/^R14\d\d-\d{6}$/)).toBeVisible();

    const detail = await ok<{ attempts: { status: string }[]; status: string }>(api.get(`${API}/v1/admin/payments/${paymentId}`, { headers: asTenant(adminToken) }));
    expect(detail.status).toBe("succeeded");
    expect(detail.attempts.filter((a) => a.status === "succeeded")).toHaveLength(1);
  });

  test("the registration is confirmed for the participant", async ({ page }) => {
    await signIn(page, WEB, payer.mobile, payer.password);
    // confirmation arrives through the outbox worker: reload until it has run
    await expect(async () => {
      await page.goto(`${WEB}/${TENANT}/events/${eventId}`);
      await expect(page.getByText("ثبت‌نام قطعی")).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 45_000 });
  });

  test("finance sees the payment and a balanced day", async ({ page }) => {
    await signIn(page, BACKOFFICE, ADMIN.mobile, ADMIN.password);
    await page.goto(`${BACKOFFICE}/t/${TENANT}/payments`);
    await expect(page.getByText("مطابقت امروز بدون اختلاف")).toBeVisible();
    await page.getByRole("searchbox").fill(`پرداخت‌کننده ${stamp}`);
    await page.getByRole("link", { name: /^PAY-14\d\d-\d{6}$/ }).first().click();
    await expect(page.getByText("پرداخت‌شده").first()).toBeVisible();
    await expect(page.getByText("پرداخت موفق").first()).toBeVisible();
  });
});
