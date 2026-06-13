import React, { useState } from "react";
import { Mail, Lock, LogIn } from "lucide-react";
import { useTranslation } from "react-i18next";
import { I18nextProvider } from "react-i18next";
import { FormField } from "@/components/auth/FormField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { createClientI18n } from "@/i18n/client";
import type { Locale } from "@/i18n/config";

interface Props {
  serverError?: string | null;
  lang: Locale;
}

export default function SignInForm({ serverError, lang }: Props) {
  const [i18n] = useState(() => createClientI18n(lang));
  return (
    <I18nextProvider i18n={i18n}>
      <SignInFormContent serverError={serverError} />
    </I18nextProvider>
  );
}

function SignInFormContent({ serverError }: { serverError?: string | null }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  function validate() {
    const next: typeof errors = {};
    if (!email.trim()) {
      next.email = t("auth.emailRequired");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      next.email = t("auth.emailInvalid");
    }
    if (!password) {
      next.password = t("auth.passwordRequired");
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function clearError(field: keyof typeof errors) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  return (
    <form method="POST" action="/api/auth/signin" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <FormField
        id="email"
        type="email"
        label={t("auth.email")}
        value={email}
        onChange={(v) => {
          setEmail(v);
          clearError("email");
        }}
        placeholder="you@example.com"
        error={errors.email}
        icon={<Mail className="size-4" />}
      />

      <FormField
        id="password"
        label={t("auth.password")}
        type={showPassword ? "text" : "password"}
        value={password}
        onChange={(v) => {
          setPassword(v);
          clearError("password");
        }}
        placeholder={t("auth.passwordPlaceholder")}
        error={errors.password}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showPassword}
            onToggle={() => {
              setShowPassword(!showPassword);
            }}
          />
        }
      />

      <ServerError message={serverError} />

      <SubmitButton pendingText={t("auth.signingIn")} icon={<LogIn className="size-4" />}>
        {t("auth.signIn")}
      </SubmitButton>
    </form>
  );
}
