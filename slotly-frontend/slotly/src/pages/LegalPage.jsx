/**
 * The pages behind the footer and the sign-up consent line.
 *
 * These existed as `href="#"` in the footer and as unlinked prose on the sign-up
 * card: seven names for documents that could not be opened, one of which a user
 * is asked to agree to before an account is created.
 *
 * What they contain is deliberately modest. Slotly has no legal review behind it
 * and inventing the text of a privacy policy would be worse than admitting there
 * isn't one — a page that describes what the app actually does with data, and
 * says plainly that it is not a substitute for reviewed terms, is honest and
 * still answers the question most people arrive with. The route and the layout
 * are the part that has to exist now; replacing the body with reviewed copy is a
 * content change and touches nothing else.
 */
import { useParams, Navigate } from "react-router-dom";
import Page, { PageHeader } from "../components/ui/Page";
import BackLink from "../components/ui/BackLink";
import { Alert } from "../components/ui/Feedback";
import usePageTitle from "../hooks/usePageTitle";

/** Shared by every document below. */
const DRAFT_NOTICE =
  "Slotly is a portfolio project rather than a commercial service. This page describes how the app actually behaves; it has not been through legal review and is not a contract.";

const DOCUMENTS = {
  terms: {
    title: "Terms of Service",
    intro: "What you can expect from Slotly, and what it expects from you.",
    sections: [
      {
        heading: "What Slotly does",
        body: "Slotly puts providers and clients in touch so an appointment can be arranged. It stores the appointment, converts its time into each person's timezone, and carries messages between the two people involved. It is not a party to whatever service is being booked, and it does not take payment.",
      },
      {
        heading: "Your account",
        body: "One account per email address. You are responsible for what happens under your account and for keeping your password to yourself. Providers are responsible for the accuracy of the services, prices and hours they publish.",
      },
      {
        heading: "Bookings and cancellations",
        body: "A booked slot is held for you. Each provider sets how many hours' notice they need for a client-side change, and that figure is fixed at the moment you book, so a provider changing their policy later cannot affect an appointment you already hold. Providers may move or cancel appointments on their own calendar at any time.",
      },
      {
        heading: "Reviews",
        body: "You may review an appointment once it has been marked completed. Reviews are published under your first name against the provider's public page. Write about the appointment, not about the person.",
      },
      {
        heading: "Ending it",
        body: "You can stop using Slotly whenever you like. Ask us to delete your account and the personal details on it go with it; the appointment records the other party needs are kept.",
      },
    ],
  },

  privacy: {
    title: "Privacy Policy",
    intro: "What Slotly stores about you, why, and who else sees it.",
    sections: [
      {
        heading: "What is collected",
        body: "Your name, email address, timezone and — if you give one — a phone number and a profile photo. Providers also store a business name, category, currency, biography and qualifications, all of which are published on their public page by design. Everything else is a by-product of using the app: your appointments, the messages on them, and any reviews you write.",
      },
      {
        heading: "Who can see it",
        body: "Your name and photo are visible to the people you book with. Your phone number is shared with a provider only once you have an appointment with them, so they can reach you if it has to move. A provider's public page — business name, biography, qualifications, services, prices and reviews — is visible to anyone. Message threads are readable only by the two people on the appointment.",
      },
      {
        heading: "Why it is kept",
        body: "To run the appointment: to show the right time to each person, to stop a slot being double-booked, and to let the two people involved reach each other. Nothing is sold, and nothing is shared with advertisers.",
      },
      {
        heading: "Cookies",
        body: "One cookie, holding your sign-in session. It is httpOnly, so no script on the page can read it, and it is not used for tracking or analytics. There is nothing to opt out of because there is nothing else set.",
      },
      {
        heading: "Your choices",
        body: "You can edit or clear your phone number, change your name, change your password, and change your timezone at any time. Ask us to delete your account and the personal details go with it.",
      },
    ],
  },

  cookies: {
    title: "Cookie Settings",
    intro: "There is only one cookie, and it is the one that keeps you signed in.",
    sections: [
      {
        heading: "The session cookie",
        body: "Set when you sign in, cleared when you sign out, and expiring on its own after seven days. It holds a signed token identifying your account and nothing else. It is httpOnly and same-site, so it is not readable by scripts and is not sent to other sites.",
      },
      {
        heading: "Why there is nothing to configure",
        body: "Slotly sets no analytics, advertising or third-party cookies, so there is no non-essential category to turn off. If that ever changes, this page becomes a real settings screen and you will be asked before anything is set.",
      },
    ],
  },

  contact: {
    title: "Contact Us",
    intro: "How to reach a person about Slotly.",
    sections: [
      {
        heading: "About an appointment",
        body: "Message the other person on the appointment itself. Every booking has its own thread, readable only by the two of you, and it is the fastest route because it arrives with the appointment attached. Open the booking and use the message box at the bottom.",
      },
      {
        heading: "About the app",
        body: "Slotly is built and maintained as a portfolio project. Issues and questions are best raised on the repository at github.com/amitpaldevnco/Slotly, where they are read and answered.",
      },
    ],
  },

  help: {
    title: "Help Center",
    intro: "The questions that come up most.",
    sections: [
      {
        heading: "Why is a time shown differently to me and to the provider?",
        body: "It isn't — it is the same instant, written in two clocks. Slotly stores every appointment as a moment in time and renders it in whichever timezone you have set, with the other person's local time shown beside it so there is never any doubt about which one you are reading.",
      },
      {
        heading: "I cannot cancel my appointment",
        body: "Each provider sets a notice period, and once you are inside it the buttons stop working. The booking page tells you what that period is. Message the provider on the appointment and ask — they can move or cancel anything on their own calendar.",
      },
      {
        heading: "I want to change my password",
        body: "Settings → Password, while you are signed in. You will be asked for your current password as well as the new one, because a signed-in browser is not by itself proof of who is holding it.",
      },
      {
        heading: "Why can I not see any free slots?",
        body: "A slot appears only where the appointment and its buffers fit entirely inside the provider's working hours, on a day they have not blocked off, with nothing already booked. A long service on a busy week can genuinely have nothing free; try the following week, or a shorter service.",
      },
      {
        heading: "I have forgotten my password",
        body: "There is no reset-by-email link, because Slotly sends no email at all. If you signed up with Google or GitHub, use that button — it is the recovery path. If you signed up with a password and cannot remember it, the account cannot be recovered; that limitation is stated here rather than hidden.",
      },
    ],
  },
};

export default function LegalPage() {
  const { document: slug } = useParams();
  const doc = DOCUMENTS[slug];

  usePageTitle(doc?.title);

  if (!doc) return <Navigate to="/404" replace />;

  return (
    <Page narrow>
      <PageHeader
        title={doc.title}
        description={doc.intro}
        back={<BackLink to="/" label="Home" />}
      />

      <Alert tone="info" className="mb-8">
        {DRAFT_NOTICE}
      </Alert>

      <div className="space-y-8">
        {doc.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="font-display text-lg font-semibold text-ink">{section.heading}</h2>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-2">{section.body}</p>
          </section>
        ))}
      </div>
    </Page>
  );
}
