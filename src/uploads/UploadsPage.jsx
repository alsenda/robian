import { useEffect, useMemo, useRef, useState } from 'react'

function formatBytes(n) {
  const bytes = Number(n || 0)
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const v = bytes / 1024 ** i
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return String(iso || '')
  }
}

async function apiJson(url, options) {
  const res = await fetch(url, options)
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const message = data?.error?.message || `Request failed: ${res.status}`
    throw new Error(message)
  }
  return data
}

export function UploadsPage() {
  const [uploads, setUploads] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState(null)
  const fileInputRef = useRef(null)

  const loadUploads = useMemo(() => {
    return async () => {
      setIsLoading(true)
      try {
        const data = await apiJson('/api/uploads')
        setUploads(Array.isArray(data?.uploads) ? data.uploads : [])
      } finally {
        setIsLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    loadUploads().catch((e) => setStatus({ kind: 'error', message: e.message }))
  }, [loadUploads])

  const onUpload = async (file) => {
    if (!file) return

    setStatus(null)
    const form = new FormData()
    form.append('file', file)

    setIsLoading(true)
    try {
      const data = await apiJson('/api/uploads', { method: 'POST', body: form })
      setStatus({ kind: 'ok', message: `Uploaded: ${data?.upload?.originalName || file.name}` })
      await loadUploads()
      try {
        if (fileInputRef.current) fileInputRef.current.value = ''
      } catch {
        // ignore
      }
    } catch (e) {
      setStatus({ kind: 'error', message: e.message })
    } finally {
      setIsLoading(false)
    }
  }

  const onDelete = async (id) => {
    setStatus(null)
    setIsLoading(true)
    try {
      await apiJson(`/api/uploads/${encodeURIComponent(id)}`, { method: 'DELETE' })
      setStatus({ kind: 'ok', message: 'Deleted.' })
      await loadUploads()
    } catch (e) {
      setStatus({ kind: 'error', message: e.message })
    } finally {
      setIsLoading(false)
    }
  }

  const onCopyId = async (id) => {
    const text = String(id)
    try {
      await navigator.clipboard.writeText(text)
      setStatus({ kind: 'ok', message: 'Copied id to clipboard.' })
    } catch {
      try {
        // Fallback for older browsers
        const ta = document.createElement('textarea')
        ta.value = text
        ta.setAttribute('readonly', 'true')
        ta.style.position = 'fixed'
        ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        setStatus({ kind: 'ok', message: 'Copied id to clipboard.' })
      } catch {
        setStatus({ kind: 'error', message: 'Could not copy id.' })
      }
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b-4 border-black bg-sky-100 px-5 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="text-lg font-black uppercase tracking-widest">Uploads</div>
            <div className="mt-1 text-xs font-extrabold uppercase tracking-widest text-black/70">
              Upload files and reference them by id in chat.
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              className="block w-full max-w-sm border-4 border-black bg-white px-3 py-2 text-sm font-semibold shadow-brutal-sm file:mr-3 file:border-0 file:bg-lime-200 file:px-3 file:py-2 file:text-xs file:font-black file:uppercase file:tracking-widest"
              onChange={(e) => onUpload(e.target.files?.[0])}
              disabled={isLoading}
            />
          </div>
        </div>

        {status && (
          <div
            className={
              status.kind === 'ok'
                ? 'mt-3 border-4 border-black bg-lime-200 px-4 py-3 text-sm font-semibold shadow-brutal-sm'
                : 'mt-3 border-4 border-black bg-orange-200 px-4 py-3 text-sm font-semibold shadow-brutal-sm'
            }
            role="status"
          >
            {status.message}
          </div>
        )}
      </div>

      <div className="brutal-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-violet-100 px-5 py-5">
        {uploads.length === 0 ? (
          <div className="border-4 border-black bg-white px-5 py-4 text-black shadow-brutal">
            <div className="text-sm font-black uppercase tracking-widest">No uploads yet</div>
            <div className="mt-2 text-sm font-semibold text-black/80">
              Use the file picker above to upload a PDF, text file, spreadsheet, etc.
            </div>
          </div>
        ) : (
          uploads.map((u) => (
            <div key={u.id} className="border-4 border-black bg-white px-5 py-4 shadow-brutal-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="truncate text-base font-black">{u.originalName}</div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-extrabold uppercase tracking-widest text-black/70">
                    <span>id: {u.id}</span>
                    <span>type: {u.mimeType || 'unknown'}</span>
                    <span>size: {formatBytes(u.sizeBytes)}</span>
                    <span>date: {formatDate(u.createdAt)}</span>
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="border-4 border-black bg-yellow-200 px-3 py-2 text-xs font-black uppercase tracking-widest shadow-brutal-sm hover:bg-yellow-300"
                    onClick={() => onCopyId(u.id)}
                    disabled={isLoading}
                  >
                    Copy id
                  </button>

                  <a
                    className="border-4 border-black bg-sky-200 px-3 py-2 text-xs font-black uppercase tracking-widest shadow-brutal-sm hover:bg-sky-300"
                    href={`/api/uploads/${encodeURIComponent(u.id)}/download`}
                  >
                    Download
                  </a>

                  <button
                    type="button"
                    className="border-4 border-black bg-fuchsia-500 px-3 py-2 text-xs font-black uppercase tracking-widest text-white shadow-brutal-sm hover:bg-fuchsia-400"
                    onClick={() => onDelete(u.id)}
                    disabled={isLoading}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
