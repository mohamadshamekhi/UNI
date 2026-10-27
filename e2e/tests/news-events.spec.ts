import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";
import { ADMIN, API, apiLogin, approvedStudent, asTenant, BACKOFFICE, ok, TENANT, WEB } from "./support";

/**
 * Phase 5 gate: a post with a restricted audience is visible only to that audience — in the
 * feed, search and direct link — while public posts are open to everyone. Plus an event
 * registration from the portal that shows up for the organiser.
 */
test.describe.serial("news audience and event registration (phase 5 gate)", () => {
  const stamp = Date.now().toString(36);
  const publicTitle = `افتتاح آزمایشگاه نوآوری ${stamp}`;
  const secretTitle = `جلسه محرمانه شورای پژوهشی ${stamp}`;
  const eventTitle = `کارگاه یادگیری ماشین ${stamp}`;
  let api: APIRequestContext;
  let adminToken = "";
  let insider = { mobile: "", password: "Insider#E2e2026", membershipId: "" };
  let outsider = { mobile: "", password: "Outsider#E2e2026", membershipId: "" };
  let secretSlug = "";
  let eventId = "";

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
    insider = await approvedStudent(api, adminToken, insider.password, `دانشجوی مخاطب ${stamp}`);
    outsider = await approvedStudent(api, adminToken, outsider.password, `دانشجوی دیگر ${stamp}`);
    const h = { headers: asTenant(adminToken) };
    const channel = await ok<{ id: string }>(api.post(`${API}/v1/admin/news-channels`, { ...h, data: { nameFa: `کانال آزمون ${stamp}`, policy: "direct" } }));
    const publish = async (title: string, audience: Record<string, unknown>) => {
      const p = await ok<{ id: string; slug: string }>(api.post(`${API}/v1/admin/news`, { ...h, data: { channelId: channel.id, title, bodyHtml: "<p>متن خبر</p>", audience } }));
      await ok(api.post(`${API}/v1/admin/news/${p.id}/publish`, { ...h, data: {} }));
      return p.slug;
    };
    await publish(publicTitle, { public: true });
    secretSlug = await publish(secretTitle, { memberships: [insider.membershipId] });
    const start = new Date(Date.now() + 5 * 86_400_000);
    const e = await ok<{ id: string }>(
      api.post(`${API}/v1/admin/events`, {
        ...h,
        data: {
          title: eventTitle,
          startsAt: start.toISOString(),
          endsAt: new Date(start.getTime() + 3_600_000).toISOString(),
          location: "تالار فردوسی",
          visibility: "public",
          registrationRule: { members: true },
          capacity: 30,
          form: [{ key: "level", label: "سطح آشنایی", type: "select", required: true, options: [{ value: "basic", label: "مقدماتی" }, { value: "advanced", label: "پیشرفته" }] }],
        },
      }),
    );
    eventId = e.id;
    await ok(api.post(`${API}/v1/admin/events/${eventId}/status`, { ...h, data: { status: "registration_open" } }));
  });
  test.afterAll(() => api.dispose());

  test("anonymous visitors see public news only; a restricted link reveals nothing", async ({ page }) => {
    await page.goto(`${WEB}/${TENANT}/news`);
    await expect(page.getByRole("heading", { name: publicTitle })).toBeVisible();
    await expect(page.getByText(secretTitle)).toHaveCount(0);
    await page.goto(`${WEB}/${TENANT}/news/${encodeURIComponent(secretSlug)}`);
    await expect(page.getByText("این خبر پیدا نشد")).toBeVisible();
    await expect(page.getByText(secretTitle)).toHaveCount(0);
  });

  test("a member outside the audience cannot find it in feed, search or link", async ({ page }) => {
    await signIn(page, WEB, outsider.mobile, outsider.password);
    await page.goto(`${WEB}/${TENANT}/news`);
    await expect(page.getByRole("heading", { name: publicTitle })).toBeVisible();
    await page.getByRole("searchbox", { name: "جستجو در اخبار" }).fill("شورای پژوهشی");
    await expect(page.getByText("خبری با این عبارت پیدا نشد")).toBeVisible();
    await page.goto(`${WEB}/${TENANT}/news/${encodeURIComponent(secretSlug)}`);
    await expect(page.getByText("این خبر پیدا نشد")).toBeVisible();
  });

  test("the audience member reads the restricted post", async ({ page }) => {
    await signIn(page, WEB, insider.mobile, insider.password);
    await page.goto(`${WEB}/${TENANT}/news`);
    await page.getByRole("link", { name: new RegExp(secretTitle) }).click();
    await expect(page.getByRole("heading", { name: secretTitle })).toBeVisible();
    await expect(page.getByText("ویژه مخاطبان مشخص")).toBeVisible();
  });

  test("a member registers for an event from the portal", async ({ page }) => {
    await signIn(page, WEB, insider.mobile, insider.password);
    await page.goto(`${WEB}/${TENANT}/events`);
    await page.getByRole("link", { name: new RegExp(eventTitle) }).click();
    await page.getByRole("combobox", { name: "سطح آشنایی" }).selectOption("advanced");
    await page.getByRole("button", { name: "ثبت‌نام", exact: true }).click();
    await expect(page.getByText("ثبت‌نام قطعی")).toBeVisible();
    await expect(page.getByText(/کد ثبت‌نام/)).toBeVisible();
    await page.goto(`${WEB}/${TENANT}/events/mine`);
    await expect(page.getByText(eventTitle)).toBeVisible();
  });

  test("the organiser sees the registration in the panel", async ({ page }) => {
    await signIn(page, BACKOFFICE, ADMIN.mobile, ADMIN.password);
    await page.goto(`${BACKOFFICE}/t/${TENANT}/events/${eventId}`);
    await page.getByRole("tab", { name: /ثبت‌نام‌ها/ }).click();
    await expect(page.getByText(`دانشجوی مخاطب ${stamp}`)).toBeVisible();
    await expect(page.getByRole("link", { name: /خروجی اکسل/ })).toBeVisible();
  });
});
