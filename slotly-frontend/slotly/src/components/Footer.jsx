//Site footer.

import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { container } from "../lib/ui";
import { DISCOVERY_ROUTE, DISCOVERY_LABEL } from "../lib/discovery";

const API_DOCS = `${import.meta.env.VITE_API_BASE_URL}/docs`;

export default function Footer() {
  const { user } = useAuth();


  if (user) {
    return (
      <footer className="mt-auto border-t border-line">
        <div
          className={`${container} flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-4 text-xs text-ink-3`}
        >
          <p>© {new Date().getFullYear()} Slotly</p>
          <div className="flex items-center gap-4">
            <Link to="/profile" className="transition hover:text-ink">
              Settings
            </Link>
            <a href={API_DOCS} target="_blank" rel="noreferrer" className="transition hover:text-ink">
              API docs
            </a>
          </div>
        </div>
      </footer>
    );
  }

  return (
    <footer className="mt-auto border-t border-dark-line bg-dark">
      <div className={`${container} py-10`}>
        <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
          <div className="max-w-xs">
            <span className="text-[0.9375rem] font-semibold tracking-tight text-dark-ink">Slotly</span>
            <p className="mt-2 text-sm leading-relaxed text-dark-3">
              Appointment booking for service providers and the clients who book them. Every time, in
              every timezone, correct.
            </p>
          </div>

          <div className="flex gap-12 sm:gap-16">
            <FooterColumn
              title="Product"
              links={[
                { to: DISCOVERY_ROUTE, label: DISCOVERY_LABEL },
                { to: "/login", label: "For providers" },
              ]}
            />
            <FooterColumn
              title="Account"
              links={[
                { to: "/login", label: "Sign in" },
                { to: "/login", label: "Create an account" },
              ]}
            />
          </div>
        </div>

        <div className="mt-8 flex flex-col-reverse items-center justify-between gap-3 border-t border-dark-line pt-5 sm:flex-row">
          <p className="text-xs text-dark-3">© {new Date().getFullYear()} Slotly.</p>
          {/* Points at the live API reference rather than at placeholder legal
              pages that do not exist. */}
          <a
            href={API_DOCS}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-dark-3 transition hover:text-dark-ink"
          >
            API documentation
          </a>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }) {
  return (
    <div>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-dark-3">{title}</p>
      {/* `-mx-2 px-2 py-2` widens each link's hit area without moving the text:
          these were 16–18px tall, the smallest targets in the app.
          `inline-block` is what lets the vertical padding count. */}
      <ul className="mt-1.5 space-y-0.5">
        {links.map((link) => (
          <li key={`${link.to}-${link.label}`}>
            <Link
              to={link.to}
              className="-mx-2 inline-block rounded-md px-2 py-1.5 text-sm text-dark-2 transition hover:bg-white/5 hover:text-dark-ink"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
