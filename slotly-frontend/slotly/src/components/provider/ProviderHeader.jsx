
// The identity block at the top of a provider's public page.

import { useState } from "react";
import { Link } from "react-router-dom";
import Avatar from "../ui/Avatar";
import Icon from "../ui/Icon";
import { timezoneLabel } from "../../lib/time";
import { StarRatingDisplay } from "../reviews/StarRating";
import { secondaryButton, buttonSm, chipClasses, ghostButton, metricSm } from "../../lib/ui";


export default function ProviderHeader({ provider, isOwner }) {
  const [showCredentials, setShowCredentials] = useState(false);

  return (
    <div className="rounded-lg border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <Avatar src={provider.avatar_url} name={provider.name} size="xl" ring />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-[1.375rem]">
                {provider.business_name || provider.name}
              </h1>
              <p className="mt-0.5 text-sm text-ink-2">
                {provider.business_name ? provider.name : "Service provider"}
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {provider.business_type && (
                  <span className={chipClasses}>
                    <Icon name="tag" size={11} />
                    {provider.business_type}
                  </span>
                )}

                
                {provider.stats?.ratingAverage != null && (
                  <StarRatingDisplay
                    value={provider.stats.ratingAverage}
                    count={provider.stats.ratingCount}
                  />
                )}
              </div>
            </div>

            {isOwner && (
              <div className="flex shrink-0 flex-wrap gap-2">
                <Link to="/profile" className={`${secondaryButton} ${buttonSm}`}>
                  <Icon name="pencil" size={14} />
                  Edit profile
                </Link>
              </div>
            )}
          </div>

          {provider.bio && (
            <p className="mt-3 max-w-[68ch] text-[0.8125rem] leading-relaxed text-ink-2">
              {provider.bio}
            </p>
          )}

          <ProviderStats stats={provider.stats} timezone={provider.timezone} />

          
          {provider.qualifications && (
            <div className="mt-3 border-t border-line-soft pt-3">
              <button
                type="button"
                onClick={() => setShowCredentials((open) => !open)}
                aria-expanded={showCredentials}
                className={`${ghostButton} ${buttonSm} -ml-2.5`}
              >
                <Icon name={showCredentials ? "chevronDown" : "chevronRight"} size={14} />
                Qualifications & experience
              </button>

              {showCredentials && (
              
                <p className="mt-1.5 max-w-[68ch] whitespace-pre-line pl-1 text-[0.8125rem] leading-relaxed text-ink">
                  {provider.qualifications}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProviderStats({ stats, timezone }) {
  const figures = stats
    ? [
        {
          icon: "calendarCheck",
          value: stats.completedAppointments,
          label: stats.completedAppointments === 1 ? "appointment" : "appointments",
        },
        {
          icon: "users",
          value: stats.clientsServed,
          label: stats.clientsServed === 1 ? "client" : "clients",
        },
        {
          icon: "tag",
          value: stats.activeServices,
          label: stats.activeServices === 1 ? "service" : "services",
        },
      ].filter((figure) => Number(figure.value) > 0)
    : [];


  if (figures.length === 0 && !timezone) return null;

  return (
    <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
      {figures.map((figure) => (
        <div key={figure.label} className="flex items-center gap-1.5">
          <Icon name={figure.icon} size={13} className="text-ink-3" />
          <dd className={metricSm}>{figure.value}</dd>
          <dt className="text-ink-3">{figure.label}</dt>
        </div>
      ))}

      {timezone && (
        <div className="flex items-center gap-1.5">
          <Icon name="globe" size={13} className="text-ink-3" />
          <dt className="sr-only">Works in</dt>
          <dd className="text-ink-2">{timezoneLabel(timezone)}</dd>
        </div>
      )}
    </dl>
  );
}
