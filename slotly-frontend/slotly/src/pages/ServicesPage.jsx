// The provider's own view of what they offer.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { parseApiError } from "../api/client";
import * as bookingsApi from "../api/bookings";
import * as providersApi from "../api/providers";
import * as servicesApi from "../api/services";
import { useApiResource } from "../hooks/useApiResource";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import ServiceCard from "../components/provider/ServiceCard";
import ServiceForm from "../components/provider/ServiceForm";
import ServiceDetailsModal from "../components/provider/ServiceDetailsModal";
import BookingCard from "../components/bookings/BookingCard";
import Icon from "../components/ui/Icon";
import Modal from "../components/ui/Modal";
import EmptyState, { ErrorState, SkeletonRows } from "../components/ui/Feedback";
import Pagination, { usePagination } from "../components/ui/Pagination";
import {
  container,
  primaryButton,
  secondaryButton,
  dangerButton,
  formatPrice,
  zoneName,
} from "../lib/ui";
import usePageTitle from "../hooks/usePageTitle";

const FILTERS = [
  { id: "active", label: "Active" },
  { id: "retired", label: "Retired" },
  { id: "all", label: "All" },
];

const BOOKINGS_PAGE_SIZE = 8;

export default function ServicesPage() {
  usePageTitle("Services");

  const { user } = useAuth();
  const toast = useToast();

  const [searchParams, setSearchParams] = useSearchParams();

  const [filter, setFilter] = useState("active");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingService, setEditingService] = useState(null);
  const [savingService, setSavingService] = useState(false);

  const [detailsService, setDetailsService] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  // The id currently being reactivated, so only that card shows a busy state
  // rather than every card on the page.
  const [reactivatingId, setReactivatingId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [bookingsService, setBookingsService] = useState(null);

  const {
    data: servicesData,
    setData: setServices,
    loading,
    error,
    reload: load,
  } = useApiResource(({ signal }) => providersApi.listServices(user.id, { signal }), {
    enabled: Boolean(user?.id),
    deps: [user?.id],
    fallback: "Could not load your services.",
    initialData: [],
  });

  const services = useMemo(() => servicesData ?? [], [servicesData]);

  const {
    data: bookingsData,
    loading: bookingsLoading,
    error: bookingsError,
    reload: reloadServiceBookings,
  } = useApiResource(
    ({ signal }) =>
     
      bookingsApi.list({ serviceId: bookingsService.id, scope: "all" }, { signal }),
    {
      enabled: Boolean(bookingsService),
      deps: [bookingsService?.id],
      fallback: "Could not load this service's bookings.",
    }
  );

  const serviceBookings = bookingsData?.bookings ?? [];


  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    setEditingService(null);
    setEditorOpen(true);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleServiceSaved = (saved) => {
    setServices((current) => {
      const exists = current.some((service) => service.id === saved.id);
      return exists
        ? current.map((service) => (service.id === saved.id ? saved : service))
        : [saved, ...current];
    });

    setEditorOpen(false);
    setEditingService(null);
    toast.success(editingService ? "Service updated." : "Service created.");
  };

  const openEditor = (service = null) => {
    setEditingService(service);
    setEditorOpen(true);
  };

  /**
   * Un-retires a service, putting the row the server returned back in the list.
   *
   * The response is used rather than a local `isActive: true` patch, because the
   * server also refreshes `updatedAt` and could adjust anything else it decides
   * belongs to an active service — reading back what was actually stored keeps
   * the card from disagreeing with the database.
   */
  const handleReactivate = async (service) => {
    setReactivatingId(service.id);
    try {
      const updated = await servicesApi.reactivate(service.id);

      setServices((current) =>
        current.map((existing) => (existing.id === updated.id ? { ...existing, ...updated } : existing))
      );
      toast.success(`${updated.name} is bookable again.`);
    } catch (err) {
      const { message, code } = parseApiError(err, "Could not reactivate that service.");
      // Someone double-clicked, or had the page open while it was reactivated in
      // another tab. Not an error worth alarming them about — correct the card.
      if (code === "ALREADY_ACTIVE") {
        setServices((current) =>
          current.map((existing) =>
            existing.id === service.id ? { ...existing, isActive: true } : existing
          )
        );
        toast.info(`${service.name} is already active.`);
      } else {
        toast.error(message);
      }
    } finally {
      setReactivatingId(null);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;

    setDeleting(true);
    try {
      const { deleted, message } = await servicesApi.remove(pendingDelete.id);

      setServices((current) =>
        deleted
          ? current.filter((service) => service.id !== pendingDelete.id)
          : // Retired, not deleted: keep it in the list marked inactive, which is
            // what the owner needs to see.
            current.map((service) =>
              service.id === pendingDelete.id ? { ...service, isActive: false } : service
            )
      );

      toast.success(message);
      setPendingDelete(null);
    } catch (err) {
      toast.error(parseApiError(err, "Could not remove that service.").message);
    } finally {
      setDeleting(false);
    }
  };

  const counts = useMemo(
    () => ({
      active: services.filter((s) => s.isActive !== false).length,
      retired: services.filter((s) => s.isActive === false).length,
      all: services.length,
    }),
    [services]
  );

  const visible = useMemo(() => {
    if (filter === "active") return services.filter((s) => s.isActive !== false);
    if (filter === "retired") return services.filter((s) => s.isActive === false);
    return services;
  }, [services, filter]);

  const bookingsPagination = usePagination(serviceBookings, BOOKINGS_PAGE_SIZE);

  return (
    <div className={`${container} py-8 md:py-12`}>
      {/* Page header — `services_management` */}
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="mb-2 font-h1-mobile text-h1-mobile text-primary md:font-h1 md:text-h1">
            Services
          </h1>
          <p className="font-body text-body text-on-surface-variant">
            Manage the services your clients can book.
          </p>
        </div>

        <button
          type="button"
          onClick={() => openEditor(null)}
          className="flex h-12 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary px-6 font-small text-small text-on-primary shadow-raise transition-colors hover:bg-primary/90"
        >
          <Icon name="add" size={18} />
          Add Service
        </button>
      </div>

      {/* The active/retired switch. Only once there is something retired to
          switch to — a tab strip of one is furniture. */}
      {!loading && !error && services.length > 0 && counts.retired > 0 && (
        <div className="no-scrollbar mb-6 flex overflow-x-auto border-b border-outline-variant">
          {FILTERS.map((option) => {
            const active = option.id === filter;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setFilter(option.id)}
                aria-current={active ? "page" : undefined}
                className={`cursor-pointer whitespace-nowrap border-b-2 px-6 py-3 font-small text-small transition-colors ${
                  active
                    ? "border-primary font-semibold text-primary"
                    : "border-transparent text-on-surface-variant hover:text-primary"
                }`}
              >
                {option.label} ({counts[option.id]})
              </button>
            );
          })}
        </div>
      )}

      <div id="services-grid">
        {loading ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <SkeletonRows key={i} count={1} variant="card" label="Loading your services…" />
            ))}
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon="category"
            title={
              services.length === 0
                ? "You have not added any services yet"
                : `No ${filter} services`
            }
            description={
              services.length === 0
                ? "Add a service with a duration and a price, and clients can start booking it. Nothing on your public page is bookable until you do."
                : "Try a different filter."
            }
            {...(services.length === 0
              ? { actionLabel: "Add your first service", onAction: () => openEditor(null) }
              : { actionLabel: "Show all", onAction: () => setFilter("all") })}
          />
        ) : (
          <ul className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {visible.map((service) => (
              <li key={service.id} className="flex">
                <div className="flex w-full">
                  <ServiceCard
                    service={service}
                    isOwner
                    providerId={user?.id}
                    canBook={false}
                    onEdit={openEditor}
                    onReactivate={handleReactivate}
                    reactivating={reactivatingId === service.id}
                    onDelete={setPendingDelete}
                    onViewBookings={setBookingsService}
                    onViewDetails={setDetailsService}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Where a service's hours come from. Worth stating on this screen,
          because "why can nobody book this?" is answered on another one. */}
      {!loading && services.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-outline-variant bg-surface px-6 py-4">
          <p className="flex items-start gap-3 font-small text-small text-on-surface-variant">
            <Icon name="schedule" size={20} className="shrink-0 text-on-surface-variant" />
            <span>
              Slots come from your weekly hours in {zoneName(user?.timezone)}. A service can also
              have hours of its own.
            </span>
          </p>
          <Link
            to="/availability"
            className="rounded-md border border-outline-variant px-4 py-2 font-small text-small text-primary transition-colors hover:bg-surface-container-low"
          >
            Manage availability
          </Link>
        </div>
      )}

      <Modal
        open={editorOpen}
        onClose={() => !savingService && setEditorOpen(false)}
        title={editingService ? "Edit service" : "New service"}
        description={
          editingService
            ? "Changes apply to new bookings; existing ones keep what they were booked at."
            : "Clients can book this as soon as it is saved."
        }
        size="xl"
        footer={
          <>
            <button
              type="button"
              onClick={() => setEditorOpen(false)}
              disabled={savingService}
              className={secondaryButton}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="service-form"
              disabled={savingService}
              className={primaryButton}
            >
              {savingService ? "Saving…" : editingService ? "Save changes" : "Create service"}
            </button>
          </>
        }
      >
        <ServiceForm
          // Remounted per service, so switching from editing one to creating
          // another does not carry the first one's values across.
          key={editingService?.id ?? "new"}
          formId="service-form"
          existingService={editingService}
          onSaved={handleServiceSaved}
          onBusyChange={setSavingService}
        />
      </Modal>

      <ServiceDetailsModal
        service={detailsService}
        provider={user}
        providerId={user?.id}
        canBook={false}
        isOwner
        onClose={() => setDetailsService(null)}
        onEdit={(target) => {
          setDetailsService(null);
          openEditor(target);
        }}
      />

      
      <Modal
        open={Boolean(pendingDelete)}
        onClose={() => !deleting && setPendingDelete(null)}
        title="Remove this service?"
        footer={
          <>
            <button
              type="button"
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
              className={secondaryButton}
            >
              Keep it
            </button>
            <button type="button" onClick={handleDelete} disabled={deleting} className={dangerButton}>
              {deleting ? "Removing…" : "Remove service"}
            </button>
          </>
        }
      >
        <p className="text-sm text-ink-2">
          <span className="font-medium text-ink">{pendingDelete?.name}</span> will stop being
          offered to new clients.
        </p>
        
        <p className="mt-2.5 text-sm leading-relaxed text-ink-2">
          If anyone has ever booked it, the service is retired rather than deleted, so those
          appointments and their history stay intact. Any upcoming bookings still go ahead.
        </p>
      </Modal>

     
      <Modal
        open={Boolean(bookingsService)}
        onClose={() => setBookingsService(null)}
        title={bookingsService ? bookingsService.name : "Bookings"}
        description={
          bookingsService
            ? `Every booking for this service · ${formatPrice(bookingsService.stats?.totalEarnings, bookingsService.currency)} earned`
            : undefined
        }
        size="lg"
      >
        {bookingsError ? (
          <ErrorState message={bookingsError} onRetry={reloadServiceBookings} />
        ) : bookingsLoading ? (
          <SkeletonRows count={3} label="Loading bookings for this service…" />
        ) : serviceBookings.length === 0 ? (
          <EmptyState
            compact
            icon="calendar"
            title="Nobody has booked this yet"
            description="It will appear here as soon as someone does."
          />
        ) : (
          <>
            <ul className="space-y-2">
              {bookingsPagination.pageItems.map((booking) => (
                <li key={booking.id}>
                  <BookingCard booking={booking} viewerRole="provider" />
                </li>
              ))}
            </ul>
            <Pagination
              page={bookingsPagination.page}
              pageCount={bookingsPagination.pageCount}
              onChange={bookingsPagination.setPage}
              total={bookingsPagination.total}
              from={bookingsPagination.from}
              to={bookingsPagination.to}
              unit="booking"
              className="mt-3"
            />
          </>
        )}
      </Modal>
    </div>
  );
}
