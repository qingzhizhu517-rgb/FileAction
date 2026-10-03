import { useState, type DragEvent, type FormEvent } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import {
  FileText,
  Upload,
  ArrowRight,
  Search,
  LayoutGrid,
  List,
  ArrowUpRight,
} from "lucide-react";
import { useSession } from "../../app/session";
import { ApiError, items } from "../../shared/api";
import { Empty, ErrorNotice, Modal } from "../../shared/ui";
import type {
  Configuration,
  DocumentItem,
  Workspace,
} from "../../shared/types";
import { IndexDialog } from "./IndexDialog";
import { JudgeExampleCard } from "./JudgeExampleCard";
const statuses: Record<string, string> = {
  ready: "已就绪",
  pending: "等待处理",
  queued: "排队中",
  processing: "处理中",
  failed: "失败",
  not_indexed: "未建立",
  not_requested: "未建立",
  cancelled: "已取消",
  stale: "需更新",
};
export function FilesPage() {
  const { user, api } = useSession();
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [list, setList] = useState(true);
  const [upload, setUpload] = useState(false);
  const [droppedFile, setDroppedFile] = useState<File>();
  const [dragging, setDragging] = useState(false);
  const [source, setSource] = useState<DocumentItem>();
  const [uploaded, setUploaded] = useState<DocumentItem>();
  const [indexDoc, setIndexDoc] = useState<DocumentItem>();
  const [editDoc, setEditDoc] = useState<DocumentItem>();
  const [versionDoc, setVersionDoc] = useState<DocumentItem>();
  const [deleteDoc, setDeleteDoc] = useState<DocumentItem>();
  const [error, setError] = useState<unknown>();
  const [opening, setOpening] = useState(false);
  type FilePage = {
    items: DocumentItem[];
    next_cursor?: string | null;
    has_more?: boolean;
    total?: number;
  };
  const files = useInfiniteQuery({
    queryKey: [user.id, "documents", search, category],
    initialPageParam: "",
    queryFn: async ({ signal, pageParam }): Promise<FilePage> => {
      const parameters = new URLSearchParams();
      if (search) parameters.set("q", search);
      if (category) parameters.set("category", category);
      if (pageParam) parameters.set("cursor", pageParam);
      const suffix = parameters.size ? "?" + parameters.toString() : "";
      const page = await api.request<DocumentItem[] | FilePage>(
        "/documents" + suffix,
        { signal },
      );
      return Array.isArray(page) ? { items: page, total: page.length } : page;
    },
    getNextPageParam: (page) => page.next_cursor || undefined,
  });
  const temporary = useQuery({
    queryKey: [user.id, "temporary-workspaces"],
    queryFn: ({ signal }) =>
      api.request<Workspace[] | { items: Workspace[] }>(
        "/workspaces/temporary",
        { signal },
      ),
  });
  const visible = files.data?.pages.flatMap((page) => page.items) ?? [];
  const configuration = useQuery({
    queryKey: [user.id, "config"],
    queryFn: ({ signal }) => api.request<Configuration>("/config", { signal }),
  });
  const showExample = configuration.data?.judge_example_available === true;
  async function openWorkspace(doc: DocumentItem) {
    setOpening(true);
    setError(undefined);
    try {
      const w = await api.request<Workspace>("/workspaces", {
        method: "POST",
        body: { primary_document_id: doc.id, retention: "temporary" },
      });
      void cache.invalidateQueries({
        queryKey: [user.id, "temporary-workspaces"],
      });
      navigate("/workspaces/" + w.id);
    } catch (e) {
      setError(e);
    } finally {
      setOpening(false);
    }
  }
  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    setDroppedFile(file);
    setUpload(true);
  }
  return (
    <main className="page files-entry">
      <div className="page-heading files-heading">
        <div>
          <h1>文件空间</h1>
        </div>
        <a className="files-how" href="/intro/">
          看看文启如何理解 <ArrowUpRight size={15} />
        </a>
      </div>
      <section
        className={"files-upload-hero" + (dragging ? " is-dragging" : "")}
        aria-label="上传一份文件"
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
        onDrop={handleDrop}
      >
        <div className="files-upload-copy">
          <span className="files-upload-symbol" aria-hidden="true"><Upload size={22} /></span>
          <div>
            <h2>上传一份文件</h2>
            <p>拖入文件，或选择 TXT、Markdown、文本 PDF、DOCX · 最大 10 MiB</p>
          </div>
        </div>
        <button className="primary" onClick={() => { setDroppedFile(undefined); setUpload(true); }}>
          上传并理解 <ArrowRight size={17} />
        </button>
      </section>
      {showExample && <JudgeExampleCard upload={() => setUpload(true)} />}
      {uploaded && (
        <section
          className="temporary-bar upload-success"
          role="status"
          aria-live="polite"
        >
          <strong>上传成功：{uploaded.name}</strong>
          <span>
            {opening
              ? "正在打开阅读工作区…"
              : "文件已接收，可以继续进入工作区。"}
          </span>
          <button onClick={() => setSource(uploaded)}>预览原文</button>
          <button
            disabled={opening}
            onClick={() => void openWorkspace(uploaded)}
          >
            进入工作区
          </button>
        </section>
      )}
      {temporary.error && (
        <ErrorNotice
          error={temporary.error}
          retry={() => void temporary.refetch()}
        />
      )}{" "}
      {items(temporary.data).length > 0 && (
        <section className="temporary-bar recent-workspaces" aria-label="最近继续">
          <strong>最近继续</strong>
          {items(temporary.data).map((w) => (
            <Link key={w.id} to={"/workspaces/" + encodeURIComponent(w.id)}>
              {w.title || "未命名工作区"} <ArrowRight size={15} aria-hidden="true" />
            </Link>
          ))}
        </section>
      )}
      <div className="files-library-heading">
        <h2>我的文件</h2>
      </div>
      <div className="file-toolbar">
        <div className="tabs">
          {[
            ["", "全部文件"],
            ["notice", "机会与通知"],
            ["material", "我的材料"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={category === key ? "active" : ""}
              onClick={() => setCategory(key)}
            >
              {label}
              {!key && (
                <small>{files.data?.pages[0]?.total ?? visible.length}</small>
              )}
            </button>
          ))}
        </div>
        <div className="search-tools">
          <label className="search">
            <Search size={16} />
            <input
              aria-label="搜索文件"
              placeholder="搜索文件…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button
            aria-label="网格视图"
            aria-pressed={!list}
            className="icon-button"
            onClick={() => setList(false)}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            aria-label="列表视图"
            aria-pressed={list}
            className="icon-button"
            onClick={() => setList(true)}
          >
            <List size={16} />
          </button>
        </div>
      </div>
      {files.isPending ? (
        <p role="status">正在加载文件…</p>
      ) : files.error ? (
        <ErrorNotice error={files.error} retry={() => void files.refetch()} />
      ) : visible.length === 0 ? (
        <Empty
          title={search || category ? "没有符合条件的文件" : "还没有保存的文件"}
        >
          上传一份文件，保存后会出现在这里。
        </Empty>
      ) : (
        <div className={list ? "file-grid list-view" : "file-grid"}>
          {visible.map((doc) => (
            <article className="file-card" key={doc.id}>
              <div className="file-title">
                <span className="file-icon">
                  <FileText size={24} />
                </span>
                <h2>{doc.name}</h2>
              </div>
              <small>
                {doc.deletion_state === "deleting"
                  ? "删除处理中"
                  : doc.retention === "retained"
                    ? "已保存到文件空间"
                    : "仅本次使用"}
                {doc.size_bytes
                  ? " · " + Math.ceil(doc.size_bytes / 1024) + " KB"
                  : ""}
              </small>
              <div className="file-status">
                <span>
                  解析：{statuses[doc.parse_status] ?? doc.parse_status}
                </span>
              </div>
              <footer className="file-reading-actions">
                <button
                  className="file-read-button"
                  disabled={opening || doc.deletion_state === "deleting"}
                  onClick={() => void openWorkspace(doc)}
                >
                  读懂这份文件 <ArrowUpRight size={14} />
                </button>
                <button onClick={() => setSource(doc)}>预览原文</button>
              </footer>
              <details className="file-management">
                <summary>文件管理</summary>
                <p className="hint">
                  语义索引：{statuses[doc.index_status] ?? doc.index_status}
                </p>
                <div>
                  <button onClick={() => setEditDoc(doc)}>编辑信息</button>
                  <button onClick={() => setVersionDoc(doc)}>上传新版本</button>
                  <button onClick={() => setIndexDoc(doc)}>管理语义索引</button>
                  <button
                    disabled={doc.deletion_state === "deleting"}
                    onClick={() => setDeleteDoc(doc)}
                  >
                    删除文件
                  </button>
                </div>
              </details>
            </article>
          ))}
        </div>
      )}
      {error != null && <ErrorNotice error={error} />}
      <footer className="page-footer">
        文件与个人背景，只为属于你的下一步服务。
        <span>
          {files.data?.pages[0]?.total ?? visible.length} 份已保存文件
        </span>
        {files.hasNextPage && (
          <button
            disabled={files.isFetchingNextPage}
            onClick={() => void files.fetchNextPage()}
          >
            {files.isFetchingNextPage ? "正在加载…" : "加载更多"}
          </button>
        )}
      </footer>
      {upload && (
        <UploadDialog
          initialFile={droppedFile}
          close={() => { setUpload(false); setDroppedFile(undefined); }}
          done={(doc) => {
            setUpload(false);
            setDroppedFile(undefined);
            void cache.invalidateQueries({ queryKey: [user.id, "documents"] });
            setUploaded(doc);
            void openWorkspace(doc);
          }}
        />
      )}{" "}
      {source && (
        <SourceDialog doc={source} close={() => setSource(undefined)} />
      )}
      {editDoc && (
        <MetadataDialog
          doc={editDoc}
          close={() => setEditDoc(undefined)}
          done={() => {
            setEditDoc(undefined);
            void cache.invalidateQueries({ queryKey: [user.id, "documents"] });
          }}
        />
      )}
      {versionDoc && (
        <VersionDialog
          doc={versionDoc}
          close={() => setVersionDoc(undefined)}
          done={() => {
            setVersionDoc(undefined);
            void cache.invalidateQueries({ queryKey: [user.id, "documents"] });
          }}
        />
      )}
      {deleteDoc && (
        <DeleteDocumentDialog
          doc={deleteDoc}
          close={() => setDeleteDoc(undefined)}
          done={() => {
            setDeleteDoc(undefined);
            void cache.invalidateQueries({ queryKey: [user.id, "documents"] });
          }}
        />
      )}
      {indexDoc && (
        <IndexDialog
          doc={indexDoc}
          api={api}
          userId={user.id}
          close={() => setIndexDoc(undefined)}
        />
      )}
    </main>
  );
}

function MetadataDialog({
  doc,
  close,
  done,
}: {
  doc: DocumentItem;
  close: () => void;
  done: () => void;
}) {
  const { api } = useSession();
  const [name, setName] = useState(doc.name);
  const [category, setCategory] = useState(doc.category ?? "uncategorized");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.request("/documents/" + doc.id, {
        method: "PATCH",
        body: { name: name.trim(), category, expected_revision: doc.revision },
      });
      done();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="编辑文件信息"
      close={() => {
        if (!busy) close();
      }}
    >
      <form onSubmit={save}>
        <label>
          展示名
          <input
            value={name}
            maxLength={512}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label>
          文件分类
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="uncategorized">未分类</option>
            <option value="notice">机会与通知</option>
            <option value="material">我的材料</option>
          </select>
        </label>
        {error != null && <ErrorNotice error={error} />}
        <button className="primary" disabled={busy || !name.trim()}>
          {busy ? "正在保存…" : "保存信息"}
        </button>
      </form>
    </Modal>
  );
}

function VersionDialog({
  doc,
  close,
  done,
}: {
  doc: DocumentItem;
  close: () => void;
  done: () => void;
}) {
  const { api } = useSession();
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    form.set("expected_revision", String(doc.revision));
    setBusy(true);
    setError(undefined);
    try {
      await api.request("/documents/" + doc.id + "/versions", {
        method: "POST",
        body: form,
      });
      done();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="上传新版本"
      close={() => {
        if (!busy) close();
      }}
    >
      <form onSubmit={submit}>
        <label className="upload-area">
          选择新原件
          <input
            type="file"
            accept=".txt,.md,.pdf,.docx"
            required
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0])}
          />
          <small>解析失败不会替换当前可读版本。</small>
        </label>
        {error != null && <ErrorNotice error={error} />}
        <button className="primary" disabled={busy || !file}>
          {busy ? "正在解析…" : "上传新版本"}
        </button>
      </form>
    </Modal>
  );
}

function DeleteDocumentDialog({
  doc,
  close,
  done,
}: {
  doc: DocumentItem;
  close: () => void;
  done: () => void;
}) {
  const { api, user } = useSession();
  const [impact, setImpact] = useState<any>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const query = useQuery({
    queryKey: [user.id, "deletion-impact", doc.id],
    queryFn: ({ signal }) =>
      api.request<any>("/documents/" + doc.id + "/deletion-impact", { signal }),
  });
  async function confirm(currentImpact = impact) {
    if (!currentImpact) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.request("/documents/" + doc.id, {
        method: "DELETE",
        body: {
          expected_revision: currentImpact.revision,
          impact_hash: currentImpact.impact_hash,
          confirmed: true,
        },
      });
      done();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="删除文件"
      close={() => {
        if (!busy) close();
      }}
    >
      {query.isPending ? (
        <p role="status">正在计算删除影响…</p>
      ) : query.error ? (
        <ErrorNotice error={query.error} />
      ) : (
        <>
          <p>删除后将撤销此文件的读取、检索和进行中的运行。</p>
          <p>
            受影响工作区：{query.data?.workspaces?.length ?? 0}；回答：
            {query.data?.answers?.length ?? 0}；成果：
            {query.data?.artifacts?.length ?? 0}；索引：
            {query.data?.indexes?.length ?? 0}
          </p>
          <p>
            衍生内容可能仍包含个人信息，将按删除合同一并处理；独立用户编辑成果不会静默删除。
          </p>
          {error != null && <ErrorNotice error={error} />}
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              setImpact(query.data);
              void confirm(query.data);
            }}
          >
            {busy ? "正在删除…" : "确认删除文件"}
          </button>
        </>
      )}
    </Modal>
  );
}
function UploadDialog({
  initialFile,
  close,
  done,
}: {
  initialFile?: File;
  close: () => void;
  done: (doc: DocumentItem) => void;
}) {
  const { user, api } = useSession();
  const [selectedFile, setSelectedFile] = useState<File | undefined>(initialFile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const config = useQuery({
    queryKey: [user.id, "config"],
    queryFn: ({ signal }) => api.request<Configuration>("/config", { signal }),
  });
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData();
    const file = selectedFile;
    if (!file?.size || file.size > 10 * 1024 * 1024) {
      setError(
        new ApiError(413, "FILE_TOO_LARGE", "请选择非空且不超过10 MiB的文件。"),
      );
      return;
    }
    if (!config.data?.cos?.configured || !config.data.storage_notice_version) {
      setError(new ApiError(503, "STORAGE_UNAVAILABLE", "文件空间暂不可用，请稍后重试。"));
      return;
    }
    form.set("file", file);
    form.set("retention", "retained");
    form.set("consent_to_store", "true");
    form.set(
      "storage_notice_version",
      config.data?.storage_notice_version ?? "",
    );
    setBusy(true);
    setError(undefined);
    try {
      done(
        await api.request<DocumentItem>("/documents", {
          method: "POST",
          body: form,
        }),
      );
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="上传文件"
      close={() => {
        if (!busy) close();
      }}
    >
      <form onSubmit={submit}>
        <label className="upload-area">
          选择文件
          <input
            aria-label="选择文件"
            name="file"
            type="file"
            onChange={(e) => {
              setSelectedFile(e.target.files?.[0]);
            }}
            accept=".txt,.md,.pdf,.docx"
            required={!selectedFile}
            disabled={busy}
          />
          <small>TXT / Markdown / 文本PDF / DOCX · 最大10 MiB</small>
        </label>
        {selectedFile && (
          <div role="status">
            <p>已选择：{selectedFile.name}</p>
            <p className="hint">点击“开始上传”，保存到文件空间并开始阅读。</p>
          </div>
        )}
        <div className="consent-box">
          <p>点击“开始上传”即同意将原件保存到你的文件空间，方便以后继续阅读；可在文件管理中删除。</p>
          <small>发送给模型前会另外展示本次使用范围。</small>
          {config.isPending && <p role="status">正在连接文件空间…</p>}
          {config.error && <ErrorNotice error={config.error} retry={() => void config.refetch()} />}
          {config.isSuccess && !config.data?.cos?.configured && <p role="alert">文件空间暂不可用，请稍后重试。</p>}
        </div>
        {error != null && <ErrorNotice error={error} />}
        <button
          className="primary"
          disabled={
            busy ||
            !selectedFile ||
            !config.data?.cos?.configured || !config.data.storage_notice_version
          }
        >
          {busy ? "正在上传…" : "开始上传"}
        </button>
      </form>
    </Modal>
  );
}
function SourceDialog({
  doc,
  close,
}: {
  doc: DocumentItem;
  close: () => void;
}) {
  const { api, user } = useSession();
  const source = useQuery({
    queryKey: [user.id, "segments", doc.id],
    queryFn: ({ signal }) =>
      api.request<
        | { id: string; text: string; location?: string }[]
        | { items: { id: string; text: string; location?: string }[] }
      >("/documents/" + doc.id + "/segments", { signal }),
  });
  return (
    <Modal title={doc.name} close={close}>
      {source.isPending ? (
        <p role="status">正在读取原文…</p>
      ) : source.error ? (
        <ErrorNotice error={source.error} />
      ) : (
        <div className="source-text">
          {items(source.data).map((s) => (
            <section key={s.id}>
              <small>{s.location ?? "原文片段"}</small>
              <p>{s.text}</p>
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
}
