//he review panel on a booking's detail page.

import { useEffect, useState } from "react";
import { parseApiError } from "../../api/client";
import * as reviewsApi from "../../api/reviews";
import { useApiResource } from "../../hooks/useApiResource";
import { useToast } from "../../context/ToastContext";
import { StarRatingDisplay, StarRatingInput } from "./StarRating";
import { Section } from "../ui/Page";
import Field, { Textarea, CharCount } from "../ui/Field";
import { SkeletonRows } from "../ui/Feedback";
import Icon from "../ui/Icon";
import {
  primaryButton,
  secondaryButton,
  ghostButton,
  buttonSm,
  fieldErrorClasses,
} from "../../lib/ui";
import { formatDateTime } from "../../lib/time";

const MAX_COMMENT = 1000;
const MAX_REPLY = 1000;

export default function BookingReview({ bookingId, viewerRole, viewerZone, otherPartyName }) {
  const toast = useToast();

  const [editing, setEditing] = useState(false);

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [reply, setReply] = useState("");
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const { data: state, loading, reload: load } = useApiResource(
    ({ signal }) => reviewsApi.getForBooking(bookingId, { signal }),
    { deps: [bookingId] }
  );

  // Seed the form from whatever review already exists, so "Edit" opens on the
  // current text rather than an empty box.
  useEffect(() => {
    if (state?.review) {
      setRating(state.review.rating);
      setComment(state.review.comment || "");
    }
  }, [state]);

  const submitReview = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});

    try {
      const payload = { rating, comment: comment.trim() };
      if (state.review) {
        await reviewsApi.update(state.review.id, payload);
        toast.success("Your review has been updated.");
      } else {
        await reviewsApi.createForBooking(bookingId, payload);
        toast.success("Thanks — your feedback has been posted.");
      }
      setEditing(false);
      load();
    } catch (err) {
      const parsed = parseApiError(err, "Could not save your review.");
    
      if (Object.keys(parsed.fieldErrors).length > 0) {
        setFieldErrors(parsed.fieldErrors);
      } else {
        toast.error(parsed.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const submitReply = async (event) => {
    event.preventDefault();
    if (!reply.trim()) return;

    setSaving(true);
    try {
      await reviewsApi.reply(state.review.id, reply.trim());
      toast.success("Reply posted.");
      setReply("");
      load();
    } catch (err) {
      toast.error(parseApiError(err, "Could not post your reply.").message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Section title="Review">
        <SkeletonRows count={2} variant="line" />
      </Section>
    );
  }

  if (!state) return null;

  const { review, canReview, bookingStatus } = state;
  const isClient = viewerRole === "client";

  if (!review && !canReview) {
    if (!isClient) return null; // A provider does not need to be told the client has not reviewed.

    return (
      <Section title="Review" flush>
        <p className="flex items-start gap-2 px-3 py-3 text-xs leading-relaxed text-ink-3">
          <Icon name="info" size={14} className="mt-px" />
          <span>
            {bookingStatus === "no_show"
              ? "This appointment is marked as a no-show, so it cannot be reviewed."
              : bookingStatus === "cancelled"
                ? "This appointment was cancelled, so there is nothing to review."
                : "You can leave a review once this appointment has been completed."}
          </span>
        </p>
      </Section>
    );
  }

  const showForm = (!review || editing) && isClient;

  return (
    <Section
      title={review ? "Review" : "How was it?"}
      description={
        review
          ? `Public on ${isClient ? `${otherPartyName}'s` : "your"} page, first name only.`
          : "Posted publicly, signed with your first name only."
      }
      actions={
        review?.isMine && !editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={`${ghostButton} ${buttonSm}`}
          >
            <Icon name="pencil" size={13} />
            Edit
          </button>
        ) : null
      }
    >
      {showForm ? (
        <form onSubmit={submitReview} className="space-y-3.5">
          <div>
            <StarRatingInput value={rating} onChange={setRating} disabled={saving} />
            {fieldErrors.rating && (
              <p className={fieldErrorClasses}>
                <Icon name="alert" size={13} className="mt-px" />
                <span>{fieldErrors.rating}</span>
              </p>
            )}
          </div>

          <Field
            id="review-comment"
            label="Your review"
            optional
            hint="Helpful reviews mention what the appointment was like, not personal details."
            error={fieldErrors.comment}
            action={<CharCount value={comment} max={MAX_COMMENT} />}
          >
            <Textarea
              id="review-comment"
              rows={4}
              maxLength={MAX_COMMENT}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="What went well? Anything the provider should know?"
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={saving || rating === 0}
              className={`${primaryButton} ${buttonSm}`}
            >
              {saving ? "Saving…" : review ? "Update review" : "Post review"}
            </button>
            {review && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setRating(review.rating);
                  setComment(review.comment || "");
                }}
                disabled={saving}
                className={`${secondaryButton} ${buttonSm}`}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : review ? (
        /* State 3: the posted review, plus the provider's reply or reply box. */
        <div className="space-y-3">
          <div>
            <StarRatingDisplay value={review.rating} />
            {review.comment && (
              <p className="mt-2 whitespace-pre-line text-[0.8125rem] leading-relaxed text-ink">
                {review.comment}
              </p>
            )}
            <p className="mt-1.5 text-xs text-ink-3">
              {isClient ? "You" : review.author.firstName} ·{" "}
              {formatDateTime(review.createdAt, viewerZone)}
              {review.updatedAt !== review.createdAt && " (edited)"}
            </p>
          </div>

          {review.providerReply ? (
            // Indented and tinted so a reply reads as a response to the review
            // above it rather than as a second, separate review.
            <div className="rounded-md border-l-2 border-brand-line bg-subtle px-3 py-2">
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-3">
                {isClient ? `${otherPartyName} replied` : "Your reply"}
              </p>
              <p className="mt-1 whitespace-pre-line text-[0.8125rem] leading-relaxed text-ink">
                {review.providerReply}
              </p>
              <p className="mt-1.5 text-xs text-ink-3">
                {formatDateTime(review.repliedAt, viewerZone)}
              </p>
            </div>
          ) : (
            !isClient && (
              <form onSubmit={submitReply} className="border-t border-line-soft pt-3">
                <Field
                  id="review-reply"
                  label="Reply publicly"
                  hint="Shown under this review on your public page. You can reply once."
                  action={<CharCount value={reply} max={MAX_REPLY} />}
                >
                  <Textarea
                    id="review-reply"
                    rows={3}
                    maxLength={MAX_REPLY}
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    placeholder="Thank them, or address anything they raised."
                  />
                </Field>
                <button
                  type="submit"
                  disabled={saving || !reply.trim()}
                  className={`mt-2.5 ${primaryButton} ${buttonSm}`}
                >
                  {saving ? "Posting…" : "Post reply"}
                </button>
              </form>
            )
          )}
        </div>
      ) : null}
    </Section>
  );
}
