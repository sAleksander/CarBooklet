import React, { useState } from "react";
import { Mail, Lock, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { I18nextProvider } from "react-i18next";
import { FormField } from "@/components/auth/FormField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { createClientI18n } from "@/i18n/client";
import type { Locale } from "@/i18n/config";

const MIN_PASSWORD_LENGTH = 6;

interface Props {
  serverError?: string | null;
  lang: Locale;
}

export default function SignUpForm({ serverError, lang }: Props) {
  const [i18n] = useState(() => createClientI18n(lang));
  return (
    <I18nextProvider i18n={i18n}>
      <SignUpFormContent serverError={serverError} />
    </I18nextProvider>
  );
}

function SignUpFormContent({ serverError }: { serverError?: string | null }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; confirmPassword?: string }>({});

  function validate() {
    const next: typeof errors = {};

    if (!email.trim()) {
      next.email = t("auth.emailRequired");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      next.email = t("auth.emailInvalid");
    }

    if (!password) {
      next.password = t("auth.passwordRequired");
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = t("auth.passwordMinLength", { count: MIN_PASSWORD_LENGTH });
    }

    if (!confirmPassword) {
      next.confirmPassword = t("auth.confirmPasswordRequired");
    } else if (password !== confirmPassword) {
      next.confirmPassword = t("auth.passwordsMismatch");
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

  const remainingChars = MIN_PASSWORD_LENGTH - password.length;
  const passwordHint =
    !errors.password && password.length > 0 && password.length < MIN_PASSWORD_LENGTH ? (
      <p className="mt-1 text-xs text-muted-foreground">
        {t("auth.passwordCharactersNeeded", { count: remainingChars })}
      </p>
    ) : undefined;

  return (
    <form method="POST" action="/api/auth/signup" className="space-y-4" onSubmit={handleSubmit} noValidate>
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
        placeholder={t("auth.passwordMinPlaceholder", { count: MIN_PASSWORD_LENGTH })}
        error={errors.password}
        hint={passwordHint}
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

      <FormField
        id="confirmPassword"
        name="confirmPassword"
        label={t("auth.confirmPassword")}
        type={showConfirmPassword ? "text" : "password"}
        value={confirmPassword}
        onChange={(v) => {
          setConfirmPassword(v);
          clearError("confirmPassword");
        }}
        placeholder={t("auth.confirmPasswordPlaceholder")}
        error={errors.confirmPassword}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showConfirmPassword}
            onToggle={() => {
              setShowConfirmPassword(!showConfirmPassword);
            }}
          />
        }
      />

      <ServerError message={serverError} />

      <SubmitButton pendingText={t("auth.creatingAccount")} icon={<UserPlus className="size-4" />}>
        {t("auth.createAccount")}
      </SubmitButton>
    </form>
  );
}
