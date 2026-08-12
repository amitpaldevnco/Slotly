//Create or edit a service.

import { useState, useEffect } from "react";
import { imageUrl, parseApiError } from "../../api/client";
import * as servicesApi from "../../api/services";
import Field, { Input, Textarea, Select, CharCount } from "../ui/Field";
import { Alert } from "../ui/Feedback";
import Icon from "../ui/Icon";
import {
  primaryButton,
  secondaryButton,
  fileInputClasses,
  eyebrow,
  hintClasses,
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
        serviceName: existingService.service_name || "",
        description: existingService.description || "",
        price: existingService.price ?? "",
        duration: existingService.duration ?? "",
        bufferBefore: existingService.buffer_before ?? "",
        bufferAfter: existingService.buffer_after ?? "",
        slotInterval: String(existingService.slot_interval ?? 30),
      });
      setCoverImagePreview(imageUrl(existingService.cover_image) || "");
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
      formData.append("service_name", fields.serviceName);
      formData.append("description", fields.description);
      formData.append("price", fields.price);
      formData.append("duration", fields.duration);
      if (fields.bufferBefore !== "") formData.append("buffer_before", fields.bufferBefore);
      if (fields.bufferAfter !== "") formData.append("buffer_after", fields.bufferAfter);
      if (fields.slotInterval !== "") formData.append("slot_interval", fields.slotInterval);
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
    <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-5">
      {formError && <Alert tone="error">{formError}</Alert>}

      <div className="space-y-3.5">
        <Field id="service-name" label="Service name" error={errors.service_name}>
          <Input
            id="service-name"
            type="text"
            placeholder="e.g. Haircut & styling"
            value={fields.serviceName}
            onChange={handleChange("serviceName")}
          />
        </Field>

        <Field
          id="service-description"
          label="What's included"
          error={errors.description}
          hint="Line breaks are kept, so a list stays a list on your public page."
          action={<CharCount value={fields.description} max={MAX_DESCRIPTION} />}
        >
        
          <Textarea
            id="service-description"
            placeholder={
              "One item per line, e.g.\n\nHaircut includes:\n- Hair consultation\n- Hair wash\n- Cut and styling"
            }
            value={fields.description}
            onChange={handleChange("description")}
            rows={6}
            maxLength={MAX_DESCRIPTION}
          />
        </Field>
      </div>

      <fieldset className="border-t border-line pt-4">
        <legend className={`${eyebrow} mb-2.5`}>Length and price</legend>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field id="service-duration" label="Duration (minutes)" error={errors.duration}>
            <Input
              id="service-duration"
              type="number"
              min="1"
              step="1"
              placeholder="30"
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
              placeholder="25.00"
              value={fields.price}
              onChange={handleChange("price")}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="border-t border-line pt-4">
        <legend className={`${eyebrow} mb-2.5`}>How it's offered</legend>


        <Field
          id="service-interval"
          label="Slot spacing"
          error={errors.slot_interval}
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

        <div className="mt-3.5 grid gap-3.5 sm:grid-cols-2">
          <Field id="buffer-before" label="Buffer before" optional error={errors.buffer_before}>
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

          <Field id="buffer-after" label="Buffer after" optional error={errors.buffer_after}>
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

        <p className={`${hintClasses} flex items-start gap-1.5`}>
          <Icon name="info" size={13} className="mt-px" />
          <span>
            Minutes held on your calendar either side of the appointment, so bookings do not run into
            each other. Clients are not charged for it.
          </span>
        </p>
      </fieldset>

      <fieldset className="border-t border-line pt-4">
        <legend className={`${eyebrow} mb-2.5`}>Cover image</legend>

        {coverImagePreview && (
          <img
            src={coverImagePreview}
            alt="Cover preview"
            className="mb-2.5 h-28 w-full rounded-md border border-line object-cover sm:w-56"
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
          <p className="mt-1.5 flex items-start gap-1 text-xs text-danger">
            <Icon name="alert" size={13} className="mt-px" />
            <span>{errors.coverImage}</span>
          </p>
        )}
      </fieldset>

      
      {!formId && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <button type="submit" disabled={loading} className={primaryButton}>
            {loading ? "Saving…" : isEditing ? "Save changes" : "Create service"}
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
