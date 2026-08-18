/**
 * Create or edit a service — `edit_service`.
 *
 * Transcribed from the reference: a "Service Details" section card holding the
 * name, description, a two-up duration/buffer row and a two-up price/spacing
 * row, beside a sticky Live Preview showing the card a client will see.
 *
 * The reference draws this as a full page with its own top bar. Here it keeps
 * the modal it has always opened in, because `/services?new=1` is the entry
 * point the sidebar and the dashboard both use and the brief is that existing
 * routes do not change. Everything inside the modal is the reference's.
 *
 * Two of the reference's controls have no column behind them and are therefore
 * absent: a per-service Category (`services` has no category — the category is
 * on the provider) and a "Show on Public Profile" toggle (visibility follows
 * `is_active`, which is set by retiring a service, not by a switch on this
 * form).
 */

import { useState, useEffect } from "react";
import { imageUrl, parseApiError } from "../../api/client";
import * as servicesApi from "../../api/services";
import Field, { Input, Textarea, Select, CharCount } from "../ui/Field";
import { Alert } from "../ui/Feedback";
import SlotYieldPreview from "./SlotYieldPreview";
import Icon from "../ui/Icon";
import {
  primaryButton,
  secondaryButton,
  fileInputClasses,
  hintClasses,
  formatPrice,
  formatDuration,
} from "../../lib/ui";

const emptyForm = {
  serviceName: "",
  description: "",
  price: "",
  duration: "",
  bufferBefore: "",
  bufferAfter: "",
  slotInterval: "30",
};

const MAX_DESCRIPTION = 2000;

export default function ServiceForm({ existingService, onSaved, onCancel, formId, onBusyChange }) {
  const [fields, setFields] = useState(emptyForm);
  const [coverImage, setCoverImage] = useState(null);
  const [coverImagePreview, setCoverImagePreview] = useState("");
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");

  const isEditing = Boolean(existingService);

  useEffect(() => {
    onBusyChange?.(loading);
  }, [loading, onBusyChange]);

  useEffect(() => {
    if (existingService) {
      setFields({
        serviceName: existingService.name || "",
        description: existingService.description || "",
        price: existingService.price ?? "",
        duration: existingService.duration ?? "",
        bufferBefore: existingService.bufferBefore ?? "",
        bufferAfter: existingService.bufferAfter ?? "",
        slotInterval: String(existingService.slotInterval ?? 30),
      });
      setCoverImagePreview(imageUrl(existingService.coverImage) || "");
    } else {
      setFields(emptyForm);
      setCoverImagePreview("");
    }
    setCoverImage(null);
    setErrors({});
    setFormError("");
  }, [existingService]);

  const handleChange = (field) => (e) => {
    setFields((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setErrors((prev) => ({ ...prev, coverImage: "File size exceeds 5MB" }));
      return;
    }

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setErrors((prev) => ({ ...prev, coverImage: "Only JPG, PNG, and WEBP files are allowed" }));
      return;
    }

    setCoverImage(file);
    setErrors((prev) => ({ ...prev, coverImage: "" }));

    const reader = new FileReader();
    reader.onload = (event) => setCoverImagePreview(event.target.result);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setFormError("");
    setErrors({});

    try {
      const formData = new FormData();
      formData.append("serviceName", fields.serviceName);
      formData.append("description", fields.description);
      formData.append("price", fields.price);
      formData.append("duration", fields.duration);
      if (fields.bufferBefore !== "") formData.append("bufferBefore", fields.bufferBefore);
      if (fields.bufferAfter !== "") formData.append("bufferAfter", fields.bufferAfter);
      if (fields.slotInterval !== "") formData.append("slotInterval", fields.slotInterval);
      if (coverImage) formData.append("coverImage", coverImage);

      const saved = isEditing
        ? await servicesApi.update(existingService.id, formData)
        : await servicesApi.create(formData);

      onSaved(saved);
      if (!isEditing) {
        setFields(emptyForm);
        setCoverImage(null);
        setCoverImagePreview("");
      }
    } catch (err) {
      const parsed = parseApiError(err, "Something went wrong. Please try again.");
      // Always an object, so test for content rather than truthiness.
      if (Object.keys(parsed.fieldErrors).length > 0) {
        setErrors(parsed.fieldErrors);
      } else {
        setFormError(parsed.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <form id={formId} onSubmit={handleSubmit} noValidate>
      <div className="grid grid-cols-1 items-start gap-gutter lg:grid-cols-12">
        {/* Left column: the form */}
        <div className="flex flex-col gap-6 lg:col-span-7">
          {formError && <Alert tone="error">{formError}</Alert>}

          <section className="rounded-lg border border-outline-variant bg-surface-container-lowest p-6">
            <h2 className="mb-6 font-h3 text-h3 text-primary">Service Details</h2>

            <div className="flex flex-col gap-5">
              <Field id="service-name" label="Service Name" error={errors.serviceName}>
                <Input
                  id="service-name"
                  type="text"
                  placeholder="e.g. Initial Consultation"
                  value={fields.serviceName}
                  onChange={handleChange("serviceName")}
                />
              </Field>

              <Field
                id="service-description"
                label="Description"
                error={errors.description}
                hint="Visible on your booking page. Line breaks are kept, so a list stays a list."
                action={<CharCount value={fields.description} max={MAX_DESCRIPTION} />}
              >
                <Textarea
                  id="service-description"
                  placeholder="Describe what clients can expect from this service…"
                  value={fields.description}
                  onChange={handleChange("description")}
                  rows={4}
                  maxLength={MAX_DESCRIPTION}
                  className="min-h-[100px] resize-y"
                />
              </Field>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <Field
                  id="service-duration"
                  label="Duration (minutes)"
                  error={errors.duration}
                >
                  <Input
                    id="service-duration"
                    type="number"
                    min="1"
                    step="1"
                    placeholder="60"
                    value={fields.duration}
                    onChange={handleChange("duration")}
                  />
                </Field>

                <Field id="service-price" label="Price" error={errors.price}>
                  <Input
                    id="service-price"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={fields.price}
                    onChange={handleChange("price")}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <Field
                  id="buffer-before"
                  label="Buffer before"
                  optional
                  error={errors.bufferBefore}
                >
                  <Input
                    id="buffer-before"
                    type="number"
                    min="0"
                    step="1"
                    placeholder="0"
                    value={fields.bufferBefore}
                    onChange={handleChange("bufferBefore")}
                  />
                </Field>

                <Field
                  id="buffer-after"
                  label="Buffer after"
                  optional
                  error={errors.bufferAfter}
                  hint="Extra time held after the appointment."
                >
                  <Input
                    id="buffer-after"
                    type="number"
                    min="0"
                    step="1"
                    placeholder="0"
                    value={fields.bufferAfter}
                    onChange={handleChange("bufferAfter")}
                  />
                </Field>
              </div>

              <Field
                id="service-interval"
                label="Slot spacing"
                error={errors.slotInterval}
                hint="How far apart the start times you offer are — not how long the appointment is."
              >
                <Select
                  id="service-interval"
                  value={fields.slotInterval}
                  onChange={handleChange("slotInterval")}
                >
                  {[10, 15, 20, 30, 45, 60, 90, 120].map((minutes) => (
                    <option key={minutes} value={String(minutes)}>
                      Every {minutes} minutes
                    </option>
                  ))}
                </Select>
              </Field>

              <p className={`${hintClasses} flex items-start gap-2`}>
                <Icon name="info" size={16} className="mt-px shrink-0" />
                <span>
                  Buffers are minutes held on your calendar either side of the appointment, so
                  bookings do not run into each other. Clients are not charged for them.
                </span>
              </p>

              {/* Sits directly under the four controls it depends on, because
                  the point is to watch the number change while adjusting them.
                  Duration, both buffers and the spacing interact in a way that
                  is genuinely hard to predict — see the component. */}
              <SlotYieldPreview fields={fields} serviceId={existingService?.id} />

              <hr className="border-t border-outline-variant" />

              <div>
                <p className="mb-2 block font-small text-small text-on-surface">Cover image</p>

                {coverImagePreview && (
                  <img
                    src={coverImagePreview}
                    alt="Cover preview"
                    className="mb-3 h-28 w-full rounded-md border border-outline-variant object-cover sm:w-56"
                  />
                )}

                <input
                  type="file"
                  aria-label="Cover image"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileChange}
                  className={fileInputClasses}
                />
                <p className={hintClasses}>JPG, PNG or WEBP, max 5MB.</p>
                {errors.coverImage && (
                  <p className="mt-2 flex items-start gap-1.5 font-caption text-caption text-error">
                    <Icon name="warning" size={14} className="mt-px" />
                    <span>{errors.coverImage}</span>
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>

        {/* Right column: live preview */}
        <div className="lg:sticky lg:top-4 lg:col-span-5">
          <div className="flex flex-col gap-4 rounded-lg border border-outline-variant bg-surface-container-low p-4 md:p-6">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-small text-small uppercase tracking-wider text-on-surface-variant">
                Live Preview
              </span>
              <Icon name="visibility" size={18} className="text-on-surface-variant" />
            </div>

            <div className="rounded-md border border-outline-variant bg-surface-container-lowest p-5 transition-shadow hover:shadow-raise">
              <div className="mb-3 flex items-start justify-between gap-3">
                <h3 className="line-clamp-2 font-h3 text-h3 text-primary">
                  {fields.serviceName || "Service name"}
                </h3>
                <span className="ml-3 whitespace-nowrap rounded-md bg-primary/10 px-2 py-0.5 font-small text-small uppercase tracking-wide text-primary">
                  {fields.price === "" ? "—" : formatPrice(fields.price)}
                </span>
              </div>

              <p className="mb-4 line-clamp-3 font-body text-body text-on-surface-variant">
                {fields.description || "Description will appear here."}
              </p>

              <div className="flex items-center gap-4 font-caption text-caption text-on-surface-variant">
                <span className="flex items-center gap-1">
                  <Icon name="schedule" size={16} />
                  {fields.duration === "" ? "—" : formatDuration(fields.duration)}
                </span>
                <span className="flex items-center gap-1">
                  <Icon name="hourglass_empty" size={16} />
                  {(Number(fields.bufferBefore) || 0) + (Number(fields.bufferAfter) || 0)} min buffer
                </span>
              </div>

              <button
                type="button"
                disabled
                className="mt-4 flex h-10 w-full cursor-not-allowed items-center justify-center rounded-md bg-surface-container-high font-small text-small text-on-surface opacity-70"
              >
                Book Now
              </button>
            </div>

            <div className="mt-2 rounded-md border border-dashed border-outline-variant bg-surface-bright p-3 text-center">
              <p className="font-caption text-caption text-on-surface-variant">
                This is how the service appears to your clients on your booking page.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Standalone use — the modal supplies its own footer buttons. */}
      {!formId && (
        <div className="mt-6 flex flex-wrap gap-3 border-t border-outline-variant pt-6">
          <button type="submit" disabled={loading} className={primaryButton}>
            {loading ? "Saving…" : isEditing ? "Save Changes" : "Create service"}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} className={secondaryButton}>
              Cancel
            </button>
          )}
        </div>
      )}
    </form>
  );
}
