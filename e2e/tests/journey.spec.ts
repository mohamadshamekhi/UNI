import { expect, test } from "@playwright/test";
import { ADMIN, BACKOFFICE, forceOtp, KNOWN_CODE, PNG, TENANT, uniqueMobile, WEB } from "./support";

/** Acceptance path of phase 1: register in the portal → approve in the backoffice → active status. */
test.describe.serial("membership journey", () => {
  const mobile = uniqueMobile();
  const fullName = `دانشجوی آزمون ${mobile.slice(-4)}`;
  const password = "E2e#Student#Pass1";

  test("portal home lists universities and remembers the theme", async ({ page }) => {
    await page.goto(WEB);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("همه در یک سامانه");
    await expect(page.locator("#universities li").first()).toBeVisible();
    await page.getByLabel("فیلتر دانشگاه‌ها").fill("تهران");
    await expect(page.getByText(/نتیجه برای/)).toBeVisible();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: "حالت تیره" }).first().click();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "حالت روشن" }).first().click();
  });

  test("student registers with OTP and a document", async ({ page }) => {
    await page.goto(`${WEB}/${TENANT}/register`);
    await page.getByLabel("دانشکده").selectOption({ index: 1 });
    await page.getByRole("button", { name: "ادامه" }).click();

    await page.getByLabel("نام و نام خانوادگی").fill(fullName);
    await page.getByLabel("شماره دانشجویی").fill(`99${mobile.slice(-6)}`);
    await page.getByLabel("مقطع تحصیلی").selectOption("msc");
    await page.getByRole("button", { name: "ادامه" }).click();

    await page.getByLabel("شماره موبایل").fill(mobile);
    await page.getByRole("button", { name: "دریافت کد تأیید" }).click();
    await expect(page.getByLabel("کد تأیید")).toBeVisible();
    await forceOtp(mobile, "register");
    await page.getByLabel("کد تأیید").fill(KNOWN_CODE);
    await page.getByRole("button", { name: "تأیید شماره" }).click();

    await page.locator("#doc-upload").setInputFiles({ name: "card.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByText("card.png")).toBeVisible();
    await page.getByRole("button", { name: "ادامه" }).click();

    await page.getByRole("textbox", { name: "رمز عبور", exact: true }).fill(password);
    await page.getByLabel("تکرار رمز عبور").fill(password);
    await page.getByLabel(/شرایط استفاده/).check();
    await page.getByRole("button", { name: "ثبت درخواست عضویت" }).click();

    await page.waitForURL(`**/${TENANT}/me**`);
    await expect(page.getByText("در انتظار بررسی").first()).toBeVisible();
  });

  test("expert approves the request in the backoffice", async ({ page }) => {
    await page.goto(`${BACKOFFICE}/login`);
    await page.getByLabel("شماره موبایل یا ایمیل").fill(ADMIN.mobile);
    await page.getByRole("textbox", { name: "رمز عبور", exact: true }).fill(ADMIN.password);
    await page.getByRole("button", { name: "ورود", exact: true }).click();
    await page.waitForURL(`${BACKOFFICE}/`);

    await page.goto(`${BACKOFFICE}/t/${TENANT}/memberships?status=pending_review`);
    await page.getByRole("link", { name: fullName }).click();
    await page.getByRole("button", { name: "تأیید عضویت" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "تأیید", exact: true }).click();
    await expect(page.getByText("عضویت تأیید شد", { exact: false })).toBeVisible();
  });

  test("student sees an active membership", async ({ page }) => {
    await page.goto(`${WEB}/${TENANT}/login`);
    await page.getByLabel("شماره موبایل یا ایمیل").fill(mobile);
    await page.getByRole("textbox", { name: "رمز عبور", exact: true }).fill(password);
    await page.getByRole("button", { name: "ورود", exact: true }).click();
    await page.waitForURL(`**/${TENANT}/me`);
    await expect(page.getByText("فعال").first()).toBeVisible();
    await expect(page.getByText("عضویت شما فعال است")).toBeVisible();
  });
});
