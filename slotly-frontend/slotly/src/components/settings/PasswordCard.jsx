/**
 * Changing your password from inside Settings.
 *
 * This is Slotly's whole password-recovery story, and it is deliberately a
 * narrow one: you can change your password while signed in, and there is no
 * "forgot password" link on the sign-in page. Sending a reset link needs an
 * email transport this app does not have, and a reset flow whose delivery
 * mechanism is the server log is not a feature — so rather than half-build it,
 * the limitation is stated plainly to the person it affects (see the note this
 * renders under the form).
 *
 * ## Its own form, and its own submit
 *
 * Settings' main form saves the timezone, which can be refused on its own terms
 * when a provider's appointments would fall outside their new working hours.
 * One Save button for both would mean a failure that could have come from either
 * change and a partial success with nothing to report it.
 *
 * ## Two shapes, one component
 *
 * An account created with Google or GitHub has no password to verify, so it is
 * asked for one field rather than three and the wording says "add" rather than
 * "change". Splitting that into two components would duplicate the validation
 * and the submit for the sake of one conditional field.
 */
import { useState } from "react";
import * as authApi from "../../api/auth";
import { parseApiError } from "../../api/client";
import Field from "../ui/Field";
import PasswordInput from "../ui/PasswordInput";
import Icon from "../ui/Icon";
import { useToast } from "../../context/ToastContext";
import { checkPassword, checkPasswordConfirmation, collectErrors } from "../../lib/validation";
import { primaryButton, buttonSm } from "../../lib/ui";

/**
 * @param {object} props
 * @param {boolean} props.hasPassword Whether the account already has one. False
 *   for a Google- or GitHub-only account, which is adding rather than changing.
 */
export default function PasswordCard({ hasPassword }) {
  const toast = useToast();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const clear = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError("");

    const problems = collectErrors({
      // Only checked for presence here. Whether it is *correct* is the server's
      // answer, and asking the server is the only way to find out.
      currentPassword:
        hasPassword && !currentPassword ? "Enter your current password" : null,
      newPassword: checkPassword(newPassword),
      confirmPassword: checkPasswordConfirmation(newPassword, confirmPassword),
    });

    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      return;
    }

    setErrors({});
    setSaving(true);

    try {
      const result = await authApi.changePassword({
        ...(hasPassword ? { currentPassword } : {}),
        newPassword,
      });

      clear();
      toast.success(
        result.hadPassword
          ? "Password changed. Use the new one next time you sign in."
          : "Password added. You can now sign in with your email as well."
      );
    } catch (err) {
      const parsed = parseApiError(err, "Could not change your password.");

      // The server reports a wrong current password as a 401 carrying the field
      // name, rather than as a validation list, so that it reads the same as any
      // other refusal to confirm a secret. Attached to the input all the same.
      if (parsed.details?.field) {
        setErrors({ [parsed.details.field]: parsed.message });
      } else if (Object.keys(parsed.fieldErrors).length > 0) {
        setErrors(parsed.fieldErrors);
      } else {
        setFormError(parsed.message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {formError && (
        <p role="alert" className="text-sm text-danger-ink">
          {formError}
        </p>
      )}

      {hasPassword && (
        <Field
          id="current-password"
          label="Current password"
          error={errors.currentPassword}
          required
        >
          <PasswordInput
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            placeholder="••••••••"
          />
        </Field>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="new-password"
          label={hasPassword ? "New password" : "Password"}
          error={errors.newPassword}
          hint="At least 8 characters."
          required
        >
          <PasswordInput
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="••••••••"
          />
        </Field>

        <Field
          id="confirm-new-password"
          label="Confirm password"
          error={errors.confirmPassword}
          required
        >
          <PasswordInput
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="••••••••"
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={saving} className={`${primaryButton} ${buttonSm}`}>
          {saving ? "Saving…" : hasPassword ? "Change password" : "Add password"}
        </button>

        {/* Said here, where somebody is thinking about their password, rather
            than left for them to discover on the sign-in page when they need it
            most. */}
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-ink-3">
          <Icon name="info" size={13} className="mt-px shrink-0" />
          <span>
            Slotly sends no email, so there is no reset link. Change it from here while you are
            signed in — and if you use Google or GitHub, that stays your way back in.
          </span>
        </p>
      </div>
    </form>
  );
}
