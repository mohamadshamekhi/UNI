import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { ADMIN, API, apiLogin, approvedStudent, asTenant, BACKOFFICE, facultyMember, ok, TENANT, WEB } from "./support";

/**
 * Phase 4 gate: a double-blind review runs end to end and neither side ever sees the other —
 * author submits, member and guest reviewers review, the manager decides.
 */
test.describe.serial("double-blind review (phase 4 gate)", () => {
  const stamp = Date.now().toString(36);
  const authorName = `نویسنده مقاله ${stamp}`;
  const reviewerName = `داور عضو ${stamp}`;
  const guestName = `داور مهمان ${stamp}`;
  const trackName = `داوری دوسوکور ${stamp}`;
  const title = `معماری کم‌مصرف شبکه‌های عصبی ${stamp}`;
  let api: APIRequestContext;
  let adminToken = "";
  let student = { mobile: "", password: "Author#E2e2026", membershipId: "" };
  let reviewer = { mobile: "", password: "Reviewer#E2e2026", membershipId: "" };
  let paperId = "";
  let guestLink = "";

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
    await ok(api.post(`${API}/v1/admin/paper-tracks`, { headers: asTenant(adminToken), data: { nameFa: trackName, reviewMode: "double_blind", minReviewers: 2 } }));
    student = await approvedStudent(api, adminToken, student.password, authorName);
    reviewer = await facultyMember(api, adminToken, reviewer.password, reviewerName);
    const roles = await ok<{ id: string; key: string }[]>(api.get(`${API}/v1/admin/roles`, { headers: asTenant(adminToken) }));
    await ok(api.post(`${API}/v1/admin/role-assignments`, { headers: asTenant(adminToken), data: { membershipId: reviewer.membershipId, roleId: roles.find((r) => r.key === "reviewer")!.id, scopeType: "tenant" } }));
  });
  test.afterAll(() => api.dispose());

  test("author submits a manuscript and gets a tracking code", async ({ page }) => {
    const doc = await PDFDocument.create();
    doc.addPage().drawText("Manuscript");
    doc.setAuthor(authorName);
    const pdf = Buffer.from(await doc.save());

    await signIn(page, WEB, student.mobile, student.password);
    await page.goto(`${WEB}/${TENANT}/papers/new`);
    await page.getByRole("combobox", { name: "روند ارسال", exact: true }).selectOption({ label: trackName });
    await page.getByRole("textbox", { name: "عنوان مقاله", exact: true }).fill(title);
    await page.getByRole("combobox", { name: "مقطع تحصیلی مرتبط", exact: true }).selectOption("msc");
    await page.getByRole("textbox", { name: "چکیده", exact: true }).fill("روشی برای کاهش مصرف انرژی در استنتاج شبکه‌های عصبی.");
    await expect(page.getByText("داوری این روند دوسوکور است")).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({ name: `${authorName}.pdf`, mimeType: "application/pdf", buffer: pdf });
    await expect(page.getByText(`${authorName}.pdf`)).toBeVisible();
    await page.getByRole("button", { name: "ارسال مقاله", exact: true }).click();
    await page.waitForURL(/\/papers\/[0-9a-f-]{36}/);
    paperId = page.url().match(/papers\/([0-9a-f-]{36})/)![1]!;
    await expect(page.getByText(/شناسه پیگیری: P-14\d\d-\d{6}/)).toBeVisible();
  });

  test("manager sends it to review and invites a member and a guest reviewer", async ({ page }) => {
    await signIn(page, BACKOFFICE, ADMIN.mobile, ADMIN.password);
    await page.goto(`${BACKOFFICE}/t/${TENANT}/papers/${paperId}`);
    await page.getByRole("button", { name: "ارجاع به داوری", exact: true }).click();
    await page.getByRole("button", { name: "دعوت داور", exact: true }).click();
    await page.getByRole("checkbox", { name: reviewerName }).check();
    // same faculty as the author: the dialog asks for an explicit conflict-of-interest acknowledgement
    await expect(page.getByText("هم‌واحد با نویسنده").first()).toBeVisible();
    await page.getByRole("checkbox", { name: /بررسی کردم و دعوت را تأیید می‌کنم/ }).check();
    await page.getByRole("button", { name: /دعوت ۱ داور/ }).click();
    await expect(page.getByText("دعوت داوری فرستاده شد.")).toBeVisible();

    await page.getByRole("button", { name: "داور مهمان", exact: true }).click();
    await page.getByRole("textbox", { name: "نام", exact: true }).fill(guestName);
    await page.getByRole("button", { name: "ساخت لینک دعوت", exact: true }).click();
    guestLink = await page.getByRole("textbox", { name: "لینک دعوت" }).inputValue();
    expect(guestLink).toMatch(/\/review\/[A-Za-z0-9_-]+$/);
  });

  test("member reviewer works on the scrubbed copy without seeing the author", async ({ page }) => {
    await signIn(page, BACKOFFICE, reviewer.mobile, reviewer.password);
    await page.goto(`${BACKOFFICE}/t/${TENANT}/reviews`);
    await page.getByRole("link", { name: title }).click();
    await page.getByRole("button", { name: "می‌پذیرم", exact: true }).click();
    await expect(page.getByText("manuscript-r1.pdf")).toBeVisible();
    await expect(page.getByText("هویت نویسنده در این داوری پنهان است.")).toBeVisible();
    await page.getByLabel("اصلاح جزئی").check();
    await page.getByRole("textbox", { name: "نظر برای نویسنده", exact: true }).fill("بخش ارزیابی را با مجموعه‌داده دوم تکمیل کنید.");
    await page.getByRole("button", { name: "ثبت نظر", exact: true }).click();
    await expect(page.getByText("نظر شما ثبت شد")).toBeVisible();
    expect(await page.locator("main").innerText()).not.toContain(authorName);
  });

  test("guest reviewer reviews through the one-time link", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(guestLink.replace(/^https?:\/\/[^/]+/, WEB));
    await page.getByRole("button", { name: "می‌پذیرم", exact: true }).click();
    await expect(page.getByText("manuscript-r1.pdf")).toBeVisible();
    await page.getByLabel("پذیرش", { exact: true }).check();
    await page.getByRole("textbox", { name: "نظر برای نویسنده", exact: true }).fill("کار ارزشمندی است.");
    await page.getByRole("button", { name: "ثبت نظر", exact: true }).click();
    await expect(page.getByText("نظر شما ثبت شد")).toBeVisible();
    expect(await page.locator("main").innerText()).not.toContain(authorName);
    // the link was single-use
    const again = await ctx.newPage();
    await again.goto(guestLink.replace(/^https?:\/\/[^/]+/, WEB));
    await expect(again.getByText("لینک داوری نامعتبر، منقضی یا قبلاً استفاده شده است.")).toBeVisible();
    await ctx.close();
  });

  test("manager decides; the author sees reviews by alias only", async ({ page }) => {
    await signIn(page, BACKOFFICE, ADMIN.mobile, ADMIN.password);
    await page.goto(`${BACKOFFICE}/t/${TENANT}/papers/${paperId}`);
    await expect(page.getByText(reviewerName).first()).toBeVisible(); // the manager sees identities
    await page.getByRole("combobox", { name: "تصمیم", exact: true }).selectOption("accept");
    await page.getByRole("textbox", { name: "یادداشت برای نویسنده", exact: true }).fill("با تبریک؛ اصلاحات جزئی را در نسخه نهایی اعمال کنید.");
    await page.getByRole("button", { name: "ثبت تصمیم", exact: true }).click();
    await expect(page.getByText("تصمیم ثبت و به نویسنده اطلاع داده شد.")).toBeVisible();

    await signIn(page, WEB, student.mobile, student.password);
    await page.goto(`${WEB}/${TENANT}/papers/${paperId}`);
    await expect(page.getByText("پذیرفته‌شده").first()).toBeVisible();
    await expect(page.getByText("داور ۱")).toBeVisible();
    await expect(page.getByText("داور ۲")).toBeVisible();
    const text = await page.locator("main").innerText();
    expect(text).not.toContain(reviewerName);
    expect(text).not.toContain(guestName);
  });
});
