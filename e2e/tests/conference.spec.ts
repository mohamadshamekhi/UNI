import { expect, request, test, type APIRequestContext } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { ADMIN, API, apiLogin, approvedStudent, asTenant, BACKOFFICE, ok, TENANT, WEB } from "./support";

/** EVT-11: an event's call for papers — a member submits a conference paper and the organiser sees it. */
test.describe.serial("conference call for papers", () => {
  const stamp = Date.now().toString(36);
  const eventTitle = `همایش ملی داده‌کاوی ${stamp}`;
  const paperTitle = `خوشه‌بندی سریع داده‌های جریانی ${stamp}`;
  let api: APIRequestContext;
  let adminToken = "";
  let author = { mobile: "", password: "Conf#E2e2026", membershipId: "" };
  let eventId = "";

  test.beforeAll(async () => {
    api = await request.newContext();
    adminToken = await apiLogin(api, ADMIN.mobile, ADMIN.password);
    author = await approvedStudent(api, adminToken, author.password, `نویسنده همایش ${stamp}`);
    const track = await ok<{ id: string }>(api.post(`${API}/v1/admin/paper-tracks`, { headers: asTenant(adminToken), data: { nameFa: `داوری ${eventTitle}`, reviewMode: "double_blind" } }));
    const start = new Date(Date.now() + 40 * 86_400_000);
    const e = await ok<{ id: string }>(
      api.post(`${API}/v1/admin/events`, {
        headers: asTenant(adminToken),
        data: {
          title: eventTitle,
          startsAt: start.toISOString(),
          endsAt: new Date(start.getTime() + 86_400_000).toISOString(),
          visibility: "public",
          registrationRule: { members: true },
          paperTrackId: track.id,
          paperDeadline: new Date(Date.now() + 20 * 86_400_000).toISOString(),
        },
      }),
    );
    eventId = e.id;
    await ok(api.post(`${API}/v1/admin/events/${eventId}/status`, { headers: asTenant(adminToken), data: { status: "registration_open" } }));
  });
  test.afterAll(() => api.dispose());

  test("a member submits a paper through the event's call", async ({ page }) => {
    await page.goto(`${WEB}/${TENANT}/login`);
    await page.getByRole("textbox", { name: "شماره موبایل یا ایمیل", exact: true }).fill(author.mobile);
    await page.getByRole("textbox", { name: "رمز عبور", exact: true }).fill(author.password);
    await page.getByRole("button", { name: "ورود", exact: true }).click();
    await page.waitForURL((u) => !u.pathname.endsWith("/login"));

    await page.goto(`${WEB}/${TENANT}/events`);
    await expect(page.getByRole("link", { name: new RegExp(eventTitle) }).getByText("فراخوان مقاله")).toBeVisible();
    await page.getByRole("link", { name: new RegExp(eventTitle) }).click();
    await page.getByRole("link", { name: "ارسال مقاله به همایش" }).click();
    await expect(page.getByRole("heading", { name: "ارسال مقاله به همایش" })).toBeVisible();
    await expect(page.getByText(eventTitle)).toBeVisible();
    await expect(page.getByRole("combobox", { name: "روند ارسال" })).toHaveCount(0);

    const doc = await PDFDocument.create();
    doc.addPage().drawText("Streaming clustering");
    await page.getByRole("textbox", { name: "عنوان مقاله", exact: true }).fill(paperTitle);
    await page.getByRole("combobox", { name: "مقطع تحصیلی مرتبط", exact: true }).selectOption("msc");
    await page.locator('input[type="file"]').setInputFiles({ name: "paper.pdf", mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) });
    await expect(page.getByText("paper.pdf")).toBeVisible();
    await page.getByRole("button", { name: "ارسال مقاله", exact: true }).click();
    await page.waitForURL(/\/papers\/[0-9a-f-]{36}/);
    await expect(page.getByText(`همایش «${eventTitle}»`)).toBeVisible();
  });

  test("the organiser finds it under the event's papers", async ({ page }) => {
    await page.goto(`${BACKOFFICE}/login`);
    await page.getByRole("textbox", { name: "شماره موبایل یا ایمیل", exact: true }).fill(ADMIN.mobile);
    await page.getByRole("textbox", { name: "رمز عبور", exact: true }).fill(ADMIN.password);
    await page.getByRole("button", { name: "ورود", exact: true }).click();
    await page.waitForURL((u) => !u.pathname.endsWith("/login"));
    await page.goto(`${BACKOFFICE}/t/${TENANT}/events/${eventId}`);
    await page.getByRole("link", { name: /مقاله‌های ارسالی \(۱\)/ }).click();
    await expect(page.getByRole("link", { name: paperTitle })).toBeVisible();
    await expect(page.getByText(`همایش «${eventTitle}»`)).toBeVisible();
  });
});
