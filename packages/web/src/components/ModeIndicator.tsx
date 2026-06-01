"use client";

import { useEffect, useState } from "react";

type ConnStatus = "loading" | "connected" | "disconnected" | "auth-failed";

interface ModeConfig {
  mode: "cloud" | "local";
  relayHost: string | null;
}

const DOT: Record<ConnStatus, string> = {
  loading:     "bg-[#c0c5cd]",
  connected:   "bg-[#25a55f]",
  disconnected:"bg-[#d99a1b]",
  "auth-failed":"bg-[#e5533d]",
};

const LABEL: Record<ConnStatus, string> = {
  loading:      "…",
  connected:    "online",
  disconnected: "disconnected",
  "auth-failed":"auth failed",
};

export function ModeIndicator() {
  const [config, setConfig] = useState<ModeConfig | null>(null);
  const [status, setStatus] = useState<ConnStatus>("loading");

  useEffect(() => {
    fetch("/api/runtime/terminal")
      .then((r) => r.json())
      .then((data: { mode?: string; relayHost?: string | null }) => {
        setConfig({
          mode: data.mode === "cloud" ? "cloud" : "local",
          relayHost: data.relayHost ?? null,
        });
      })
      .catch(() => setConfig({ mode: "local", relayHost: null }));
  }, []);

  useEffect(() => {
    if (!config) return;

    // HEAD request — only need status code, not body
    const check = async () => {
      try {
        const res = await fetch("/api/remote-agents/overview", { method: "HEAD", cache: "no-store" });
        if (res.ok) {
          setStatus("connected");
        } else if (res.status === 401 || res.status === 403) {
          setStatus("auth-failed");
        } else {
          setStatus("disconnected");
        }
      } catch {
        setStatus("disconnected");
      }
    };

    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, [config]);

  if (!config) return null;
  const { mode, relayHost } = config;

  if (mode === "cloud") {
    return (
      <div className="flex items-center gap-1.5 px-5 pb-3 pt-0.5 text-[11px] text-[#9aa1ad]">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[status]}`} />
        <span className="font-semibold text-[#5f4fb8]">Cloud</span>
        {relayHost && (
          <span className="min-w-0 flex-1 truncate opacity-60">{relayHost}</span>
        )}
        <span className="ml-auto shrink-0 text-[#9aa1ad]">{LABEL[status]}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-5 pb-3 pt-0.5 text-[11px] text-[#9aa1ad]">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[status]}`} />
      <span>Local</span>
      <span className="opacity-50">· store.json</span>
      <span className="ml-auto shrink-0">{LABEL[status]}</span>
    </div>
  );
}
