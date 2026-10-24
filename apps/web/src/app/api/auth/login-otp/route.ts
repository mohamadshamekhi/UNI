import { loginHandler } from "@uni/shared/bff/auth";

export const POST = loginHandler("/v1/auth/login/otp");
