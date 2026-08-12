//Everything about one service, before a client commits to booking it.
import { Link } from "react-router-dom";
import Modal from "../ui/Modal";
import Avatar from "../ui/Avatar";
import Icon from "../ui/Icon";
import { imageUrl } from "../../api/client";
import {
  formatPrice,
  formatDuration,
  primaryButton,
  secondaryButton,
  eyebrow,
  insetClasses,
  badgeVariants,
  zoneName,
} from "../../lib/ui";


export default function ServiceDetailsModal({
  service,
  onClose,
  provider,
  providerId,
  canBook,
  isOwner,
  onEdit,
}) {
  const cover = imageUrl(service?.cover_image);
  const retired = service?.is_active === false;
  const hasBuffers = Number(service?.buffer_before) > 0 || Number(service?.buffer_after) > 0;

  return (
    <Modal
      open={Boolean(service)}
      onClose={onClose}
      title={service?.service_name || "Service"}
      description={
        service ? `${formatPrice(service.price)} · ${formatDuration(service.duration)}` : undefined
      }
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButton}>
            Close
          </button>

          {isOwner ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onEdit(service);
              }}
              className={primaryButton}
            >
              <Icon name="pencil" size={15} />
              Edit this service
            </button>
          ) : retired ? null : canBook ? (
            // Reuses the existing booking entry point — no new booking logic.
            <Link to={`/providers/${providerId}/book/${service?.id}`} className={primaryButton}>
              Choose a time
            </Link>
          ) : (
            // Sends a guest through sign-in and back to the slot picker they
            // were reaching for, the same contract the card uses.
            <Link
              to="/login"
              state={{ from: `/providers/${providerId}/book/${service?.id}` }}
              className={primaryButton}
            >
              Sign in to book
            </Link>
          )}
        </>
      }
    >
      {service && (
        <div className="space-y-4">
          {cover && (
            <img
              src={cover}
              alt=""
              className="h-36 w-full rounded-md border border-line object-cover"
            />
          )}

          {retired && <span className={badgeVariants.neutral}>No longer offered</span>}

          {service.description ? (
            <div>
              <p className={eyebrow}>What this includes</p>
              
              <p className="mt-1.5 whitespace-pre-line text-[0.8125rem] leading-relaxed text-ink">
                {service.description}
              </p>
            </div>
          ) : (
            <p className="text-[0.8125rem] text-ink-3">
              {isOwner
                ? "No description yet. Adding one helps clients understand what they are booking."
                : "The provider has not added a description for this service."}
            </p>
          )}

          {hasBuffers && (
            <div className={insetClasses}>
              <p className={eyebrow}>Time held around the appointment</p>
              <p className="mt-1 text-[0.8125rem] text-ink">
                {Number(service.buffer_before) > 0 && `${service.buffer_before} min before`}
                {Number(service.buffer_before) > 0 && Number(service.buffer_after) > 0 && " · "}
                {Number(service.buffer_after) > 0 && `${service.buffer_after} min after`}
              </p>
              
              <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
                Reserved on the provider&apos;s calendar so appointments do not run into each other.
                Your appointment itself is {formatDuration(service.duration)}.
              </p>
            </div>
          )}

          {provider && (
            <div className="flex items-center gap-2.5 border-t border-line pt-3.5">
              <Avatar src={provider.avatar_url} name={provider.name} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-[0.8125rem] font-medium text-ink">
                  {provider.business_name || provider.name}
                </p>
                <p className="truncate text-xs text-ink-3">
                  {provider.business_name ? `${provider.name} · ` : ""}
                  {zoneName(provider.timezone)}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
