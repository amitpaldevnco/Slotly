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
import Page, { PageHeader, Toolbar } from "../components/ui/Page";
import Icon from "../components/ui/Icon";
import Modal from "../components/ui/Modal";
import { SegmentedControl } from "../components/ui/Tabs";
import EmptyState, { ErrorState, SkeletonRows } from "../components/ui/Feedback";
import Pagination, { usePagination } from "../components/ui/Pagination";
import {
  primaryButton,
  secondaryButton,
  dangerButton,
  buttonSm,
  cardClasses,
  formatPrice,
  zoneName,
} from "../lib/ui";

const FILTERS = [
  { id: "active", label: "Active" },
  { id: "retired", label: "Retired" },
  { id: "all", label: "All" },
];

const BOOKINGS_PAGE_SIZE = 8;

export default function ServicesPage() {
  const { user } = useAuth();
  const toast = useToast();

  const [searchParams, setSearchParams] = useSearchParams();

  const [filter, setFilter] = useState("active");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingService, setEditingService] = useState(null);
  const [savingService, setSavingService] = useState(false);

  const [detailsService, setDetailsService] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
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
              service.id === pendingDelete.id ? { ...service, is_active: false } : service
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
      active: services.filter((s) => s.is_active !== false).length,
      retired: services.filter((s) => s.is_active === false).length,
      all: services.length,
    }),
    [services]
  );

  const visible = useMemo(() => {
    if (filter === "active") return services.filter((s) => s.is_active !== false);
    if (filter === "retired") return services.filter((s) => s.is_active === false);
    return services;
  }, [services, filter]);

  const bookingsPagination = usePagination(serviceBookings, BOOKINGS_PAGE_SIZE);

  return (
    <Page>
      <PageHeader
        title="Services"
        description="What clients can book, how long each one takes and what it costs."
        actions={
          <>
            <Link to={`/providers/${user?.id}`} className={`${secondaryButton} hidden sm:inline-flex`}>
              <Icon name="external" size={15} />
              View public page
            </Link>
            <button type="button" onClick={() => openEditor(null)} className={primaryButton}>
              <Icon name="plus" size={15} />
              New service
            </button>
          </>
        }
      />

      {!loading && !error && services.length > 0 && counts.retired > 0 && (
        <Toolbar className="mb-3">
          <SegmentedControl
            label="Which services to show"
            panelId="services-grid"
            value={filter}
            onChange={setFilter}
            options={FILTERS.map((option) => ({ ...option, count: counts[option.id] }))}
          />
          <p className="ml-auto text-xs text-ink-3">
            Retired services keep their booking history and cannot be booked again.
          </p>
        </Toolbar>
      )}

      <div id="services-grid">
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <SkeletonRows key={i} count={1} variant="card" />
            ))}
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon="tag"
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
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((service) => (
              <li key={service.id}>
                <ServiceCard
                  service={service}
                  isOwner
                  providerId={user?.id}
                  canBook={false}
                  onEdit={openEditor}
                  onDelete={setPendingDelete}
                  onViewBookings={setBookingsService}
                  onViewDetails={setDetailsService}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {!loading && services.length > 0 && (
        <div className={`${cardClasses} mt-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3`}>
          <p className="flex items-start gap-2 text-[0.8125rem] text-ink-2">
            <Icon name="clock" size={15} className="mt-0.5 text-ink-3" />
            <span>
              Slots come from your weekly hours in {zoneName(user?.timezone)}. A service can also have
              hours of its own.
            </span>
          </p>
          <Link to="/availability" className={`${secondaryButton} ${buttonSm}`}>
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
        size="lg"
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
          <span className="font-medium text-ink">{pendingDelete?.service_name}</span> will stop being
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
        title={bookingsService ? bookingsService.service_name : "Bookings"}
        description={
          bookingsService
            ? `Every booking for this service · ${formatPrice(bookingsService.total_earnings)} earned`
            : undefined
        }
        size="lg"
      >
        {bookingsError ? (
          <ErrorState message={bookingsError} onRetry={reloadServiceBookings} />
        ) : bookingsLoading ? (
          <SkeletonRows count={3} />
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
    </Page>
  );
}
