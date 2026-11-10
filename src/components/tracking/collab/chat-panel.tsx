"use client";

import { FileText, Loader2, Paperclip, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ApiError, internalRequest } from "@/lib/client/api";
import { collabGet, collabPostForm } from "@/lib/client/collab-api";
import { COLLAB_LIMITS, dayLabel, dayStartIndexes, firstUnreadIndex, lastSeqOf, mergeMessages, messageProblem, SENDER_ROLE_LABEL, type ChatMessage, type ChatPage } from "@/lib/collab";
import { formatDateTime, formatLongDate } from "@/lib/dates";
import { ACCEPT_ATTRIBUTE, formatFileSize } from "@/lib/files";

const POLL_MS = 4000;
const POLL_ERROR_MS = 12000;
const POLL_LIMITED_MS = 45000;

const isImage = (m: string) => m === "image/png" || m === "image/jpeg" || m === "image/webp";
type FileHref = (id: string, inline?: boolean) => string;
const publicFileHref = (order: string): FileHref => (id, inline) =>
  `/api/public/tracking/collab-file/${id}?order=${encodeURIComponent(order)}&kind=chat${inline ? "&inline=1" : ""}`;
const internalFileHref = (orderId: string): FileHref => (id, inline) =>
  `/api/internal/orders/${orderId}/collab-file/${id}?kind=chat${inline ? "&inline=1" : ""}`;

function Bubble({ m, fileHref, mine, internal }: { m: ChatMessage; fileHref: FileHref; mine: boolean; internal: boolean }) {
  return (
    <li className={cn("flex flex-col gap-1", mine ? "items-end" : "items-start")} data-testid="chat-message" data-sender={m.senderKind} data-seq={m.seq}>
      <p className="px-1 text-[11.5px] text-ink-3">
        <span className="font-semibold text-ink-2">{mine && !internal ? "Anda" : m.senderName}</span>
        {(!mine || internal) && <span> · {SENDER_ROLE_LABEL[m.senderKind]}</span>}
        <span> · {formatDateTime(m.createdAt)}</span>
      </p>
      <div className={cn("max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm sm:max-w-[75%]", mine ? "rounded-tr-md bg-navy text-white" : "rounded-tl-md border border-line bg-surface text-ink")}>
        {m.body && <p className="break-words whitespace-pre-wrap">{m.body}</p>}
        {m.attachments.length > 0 && (
          <ul className={cn("flex flex-col gap-2", m.body && "mt-2")}>
            {m.attachments.map((a) => (
              <li key={a.id}>
                {isImage(a.mimeType) ? (
                  <a href={fileHref(a.id, true)} target="_blank" rel="noopener noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element -- berkas dari endpoint berautorisasi, bukan aset Next/Image */}
                    <img src={fileHref(a.id, true)} alt={a.fileName} className="max-h-48 rounded-lg object-cover" loading="lazy" />
                  </a>
                ) : null}
                <a href={fileHref(a.id)} className={cn("mt-1 inline-flex max-w-full items-center gap-1.5 text-[12.5px] font-medium underline-offset-2 hover:underline", mine ? "text-white" : "text-teal")}>
                  <FileText className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{a.fileName}</span>
                  <span className="shrink-0 opacity-70">({formatFileSize(a.fileSize)})</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/**
 * Diskusi dengan PIC. Pesan tersimpan permanen di database; pembaruan memakai polling ringan (4 dtk saat tab ini
 * terlihat dan jendela aktif; berhenti saat tersembunyi) — bukan WebSocket, jadi jeda pesan baru maksimal ±4 detik.
 */
export function ChatPanel({ orderNumber, orderId, onRead }: { orderNumber: string; /** Bila diisi = tampilan internal PIC/Manager/Admin (API internal, sudut pandang staf). */ orderId?: string; onRead?: () => void }) {
  const internal = !!orderId;
  const fileHref = internal ? internalFileHref(orderId) : publicFileHref(orderNumber);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [meta, setMeta] = useState<{ picNames: string[]; closed: boolean; initialReadSeq: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());

  const lastSeqRef = useRef(0);
  const readSeqRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const stickRef = useRef(true);

  // Polling: pesan setelah kursor terakhir; tidak berjalan saat jendela tersembunyi; menandai terbaca saat terlihat.
  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const ctl = new AbortController();

    async function markRead(seq: number) {
      if (seq <= readSeqRef.current) return;
      readSeqRef.current = seq;
      try {
        if (orderId) await internalRequest(`/api/internal/orders/${orderId}/collab`, "POST", { action: "read", upToSeq: seq });
        else await internalRequest("/api/public/tracking/collab", "POST", { order: orderNumber, action: "read", upToSeq: seq });
        onRead?.();
      } catch {
        readSeqRef.current = Math.min(readSeqRef.current, seq - 1); // coba lagi pada putaran berikutnya
      }
    }

    async function tick() {
      if (stopped) return;
      let delay = POLL_MS;
      if (!document.hidden) {
        try {
          const page = await collabGet<ChatPage>(orderId ? `/api/internal/orders/${orderId}/chat?after=${lastSeqRef.current}` : `/api/public/tracking/chat?order=${encodeURIComponent(orderNumber)}&after=${lastSeqRef.current}`, ctl.signal);
          if (stopped) return;
          if (page.messages.length > 0) {
            lastSeqRef.current = Math.max(lastSeqRef.current, lastSeqOf(page.messages));
            setMessages((prev) => mergeMessages(prev, page.messages));
          }
          setMeta((prev) => ({ picNames: page.picNames, closed: page.closed, initialReadSeq: prev ? prev.initialReadSeq : page.lastReadSeq }));
          setLoadError(null);
          setOffline(false);
          if (readSeqRef.current === 0) readSeqRef.current = page.lastReadSeq;
          // Semua pesan yang sudah tampil dianggap terbaca selama tab ini terlihat.
          if (page.lastSeq > 0 && lastSeqRef.current >= page.lastSeq) void markRead(page.lastSeq);
        } catch (e) {
          if (stopped || (e instanceof DOMException && e.name === "AbortError")) return;
          if (e instanceof ApiError && e.status === 429) delay = POLL_LIMITED_MS;
          else delay = POLL_ERROR_MS;
          setOffline(true);
          setLoadError(e instanceof ApiError ? e.message : "Diskusi belum dapat dimuat.");
        }
      }
      if (!stopped) timer = window.setTimeout(() => void tick(), delay);
    }

    timer = window.setTimeout(() => void tick(), 0);
    return () => {
      stopped = true;
      ctl.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [orderNumber, orderId, onRead]);

  // Gulir ke bawah saat ada pesan baru, kecuali pembaca sedang membaca pesan lama.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function pickFiles(list: FileList | null) {
    if (!list) return;
    const added = Array.from(list); // salin SEBELUM input dikosongkan (FileList bersifat langsung)
    setFiles((prev) => [...prev, ...added].slice(0, COLLAB_LIMITS.chatMaxFiles));
    setSendError(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function send() {
    if (sending) return;
    const problem = messageProblem(text.trim(), files);
    if (problem) {
      setSendError(problem.message);
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      const form = new FormData();
      if (!orderId) form.set("order", orderNumber);
      form.set("body", text);
      form.set("requestKey", requestKey);
      for (const f of files) form.append("attachments", f);
      const res = await collabPostForm<{ message: ChatMessage }>(orderId ? `/api/internal/orders/${orderId}/chat` : "/api/public/tracking/chat", form, orderId ? { "X-DTIC-Request": "1" } : undefined);
      lastSeqRef.current = Math.max(lastSeqRef.current, res.message.seq);
      stickRef.current = true;
      setMessages((prev) => mergeMessages(prev, [res.message]));
      setText("");
      setFiles([]);
      setRequestKey(crypto.randomUUID());
    } catch (e) {
      // Teks & berkas dipertahankan; requestKey sama sehingga mengirim ulang tidak membuat pesan ganda.
      setSendError(e instanceof ApiError ? e.message : "Pesan belum terkirim. Coba lagi.");
    } finally {
      setSending(false);
    }
  }

  const unreadAt = meta ? (internal ? messages.findIndex((m) => m.seq > meta.initialReadSeq && m.senderKind === "requester") : firstUnreadIndex(messages, meta.initialReadSeq, "requester")) : -1;
  const dayStarts = dayStartIndexes(messages);
  const now = new Date();
  const closed = meta?.closed ?? false;

  return (
    <section data-testid="chat-panel" className="flex flex-col rounded-2xl border border-line bg-surface shadow-card" aria-labelledby="chat-title">
      <header className="border-b border-line px-5 py-4 sm:px-6">
        <h2 id="chat-title" className="text-[15px] font-semibold text-navy">{internal ? "Diskusi dengan Pemohon" : "Diskusi dengan PIC"}</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-3" data-testid="chat-pic">
          {meta ? (internal ? "Pemohon melihat percakapan ini di Riwayat Request." : meta.picNames.length ? `PIC: ${meta.picNames.join(", ")}` : "PIC belum ditugaskan — pesan Anda tetap tersimpan dan akan dibaca tim DTIC.") : "Memuat percakapan…"}
        </p>
      </header>

      {offline && (
        <p role="status" data-testid="chat-error" className="border-b border-warn/20 bg-warn-soft px-5 py-2 text-[12.5px] text-ink sm:px-6">
          {loadError ?? "Koneksi bermasalah."} Mencoba lagi otomatis…
        </p>
      )}

      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex max-h-[28rem] min-h-56 flex-col overflow-y-auto px-4 py-4 sm:px-6"
        role="log"
        aria-live="polite"
        aria-label="Riwayat diskusi"
      >
        {!meta ? (
          <p className="m-auto flex items-center gap-2 text-sm text-ink-3"><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Memuat…</p>
        ) : messages.length === 0 ? (
          <p className="m-auto max-w-xs text-center text-[13px] text-ink-3" data-testid="chat-empty">
            Belum ada pesan. Tulis pertanyaan, tambahan informasi, atau lampirkan gambar/dokumen untuk PIC. Pesan tersimpan di request ini.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {messages.map((m, i) => (
              <div key={m.id} className="contents">
                {dayStarts.has(i) && (
                  <li data-testid="chat-day" className="my-1 flex justify-center">
                    <span className="rounded-full bg-subtle px-3 py-0.5 text-[11.5px] font-medium text-ink-3">{dayLabel(m.createdAt, now, formatLongDate)}</span>
                  </li>
                )}
                {i === unreadAt && (
                  <li data-testid="chat-unread-divider" className="flex items-center gap-2 text-[11.5px] font-semibold text-teal" aria-label="Pesan belum dibaca">
                    <span className="h-px flex-1 bg-teal/30" /> Belum dibaca <span className="h-px flex-1 bg-teal/30" />
                  </li>
                )}
                <Bubble m={m} fileHref={fileHref} mine={internal ? m.senderKind !== "requester" : m.senderKind === "requester"} internal={internal} />
              </div>
            ))}
          </ol>
        )}
      </div>

      <div className="border-t border-line px-4 py-3 sm:px-6">
        {closed ? (
          <Alert kind="info">Pekerjaan ini sudah selesai atau dibatalkan, sehingga diskusi ditutup. Riwayat pesan tetap dapat dibaca.</Alert>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="flex flex-col gap-2"
            noValidate
          >
            {files.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label="Berkas yang akan dikirim">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-subtle px-2.5 py-1 text-[12px] text-ink">
                    <FileText className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{f.name}</span>
                    <span className="text-ink-3">{formatFileSize(f.size)}</span>
                    <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} aria-label={`Hapus ${f.name}`} className="rounded-full p-0.5 text-ink-3 hover:bg-line hover:text-ink" disabled={sending}>
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <textarea
              data-testid="chat-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              maxLength={COLLAB_LIMITS.messageMaxChars}
              placeholder={internal ? "Tulis balasan untuk pemohon… (Ctrl+Enter untuk kirim)" : "Tulis pesan untuk PIC… (Ctrl+Enter untuk kirim)"}
              aria-label={internal ? "Pesan untuk pemohon" : "Pesan untuk PIC"}
              disabled={sending}
              className="min-h-16 w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-2 focus:ring-teal/20 disabled:opacity-60"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <input ref={fileInput} data-testid="chat-attach-input" type="file" multiple accept={ACCEPT_ATTRIBUTE} className="sr-only" tabIndex={-1} onChange={(e) => pickFiles(e.target.files)} />
                <Button type="button" variant="secondary" size="sm" icon={<Paperclip className="size-4" aria-hidden="true" />} onClick={() => fileInput.current?.click()} disabled={sending || files.length >= COLLAB_LIMITS.chatMaxFiles}>
                  Lampirkan
                </Button>
                <span className="text-[11.5px] text-ink-3">Maks. {COLLAB_LIMITS.chatMaxFiles} berkas, total 4 MB</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11.5px] text-ink-3" aria-live="off">{text.length}/{COLLAB_LIMITS.messageMaxChars}</span>
                <Button type="submit" size="sm" loading={sending} icon={<Send className="size-4" aria-hidden="true" />} data-testid="chat-send" disabled={!text.trim() && files.length === 0}>
                  Kirim
                </Button>
              </div>
            </div>
            {sendError && <p role="alert" data-testid="chat-send-error" className="text-[12.5px] text-bad">{sendError}</p>}
          </form>
        )}
      </div>
    </section>
  );
}
