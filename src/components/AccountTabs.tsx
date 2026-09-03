"use client";

import { useState } from "react";
import type { AccountData } from "@/db/queries";
import AccountManager from "@/components/AccountManager";
import MailingListManager from "@/components/MailingListManager";
import AccountSettings from "@/components/AccountSettings";

type Tab = "automation" | "mailing" | "account";

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "automation", label: "Automation", icon: "fa-diagram-project" },
  { key: "mailing", label: "Mailing Lists", icon: "fa-envelopes-bulk" },
  { key: "account", label: "Account and API", icon: "fa-user-gear" },
];

export default function AccountTabs({ data }: { data: AccountData }) {
  const [tab, setTab] = useState<Tab>("automation");

  return (
    <div>
      <div className="flex flex-wrap gap-1 rounded-xl border border-black/10 bg-field/50 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? "page" : undefined}
            className={`flex-1 whitespace-nowrap rounded-lg px-4 py-2 text-sm transition-colors ${
              tab === t.key ? "bg-green text-paper" : "text-ink-soft hover:text-ink"
            }`}
          >
            <i className={`fa-solid ${t.icon} mr-1.5 text-xs`} />
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "automation" && (
          <>
            <p className="mb-5 max-w-2xl text-sm text-ink-soft">
              Build a pipeline: pick a <span className="text-green-dark">subscription</span>, optionally shape it with
              an <span className="text-rust">artifact</span>, then choose an <span className="text-sky-700">action</span>{" "}
              to deliver it: a script, a Discord channel, or a mailing list.
            </p>
            <AccountManager
              subscriptions={data.subscriptions}
              targets={data.targets}
              artifacts={data.artifacts}
              rules={data.rules}
              mailingLists={data.mailingLists}
            />
          </>
        )}

        {tab === "mailing" && (
          <MailingListManager
            lists={data.mailingLists}
            subscribers={data.subscribers}
            templates={data.templates}
            mergeFields={data.mergeFields}
            sender={data.sender}
            accountEmail={data.profile.email}
          />
        )}

        {tab === "account" && (
          <AccountSettings profile={data.profile} apiKeyPrefix={data.apiKeyPrefix} />
        )}
      </div>
    </div>
  );
}
