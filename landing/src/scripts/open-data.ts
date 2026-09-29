interface SnapshotEntry {
  snapshot_date: string;
  generated_at: string;
  row_count: number;
  byte_size: number;
  sha256: string;
  schema_version: number;
  csv_path: string;
  metadata_path: string;
}

interface Catalog {
  schema_version: number;
  updated_at: string | null;
  snapshots: SnapshotEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSnapshotEntry(value: unknown): value is SnapshotEntry {
  return isRecord(value) &&
    typeof value.snapshot_date === "string" &&
    typeof value.generated_at === "string" &&
    typeof value.row_count === "number" &&
    typeof value.byte_size === "number" &&
    typeof value.sha256 === "string" &&
    typeof value.schema_version === "number" &&
    typeof value.csv_path === "string" &&
    typeof value.metadata_path === "string";
}

function parseCatalog(value: unknown): Catalog {
  if (!isRecord(value) ||
      typeof value.schema_version !== "number" ||
      !(value.updated_at === null || typeof value.updated_at === "string") ||
      !Array.isArray(value.snapshots) ||
      !value.snapshots.every(isSnapshotEntry)) {
    throw new Error("Snapshot catalog has an unexpected format.");
  }
  return {
    schema_version: value.schema_version,
    updated_at: value.updated_at,
    snapshots: value.snapshots,
  };
}

const dateFormatter = new Intl.DateTimeFormat("en-NZ", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const numberFormatter = new Intl.NumberFormat("en-NZ");

function formatDate(value: string): string {
  return dateFormatter.format(new Date(`${value}T00:00:00Z`));
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) {
    return `${Math.ceil(value / 1024)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function appendText(parent: HTMLElement, tag: "span" | "strong" | "code", text: string): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = text;
  parent.append(element);
  return element;
}

function renderSnapshot(
  snapshot: SnapshotEntry,
  catalogUrl: URL,
  detailed: boolean,
  isLatest = false,
): HTMLLIElement {
  const item = document.createElement("li");
  item.className = detailed ? "snapshot-entry snapshot-entry-detailed" : "snapshot-entry";
  if (isLatest) {
    item.classList.add("snapshot-entry-latest");
  }

  const dateWrap = document.createElement("div");
  dateWrap.className = "snapshot-entry-date";

  const date = document.createElement("time");
  date.dateTime = snapshot.snapshot_date;
  date.textContent = formatDate(snapshot.snapshot_date);
  dateWrap.append(date);

  if (isLatest) {
    const badge = document.createElement("span");
    badge.className = "snapshot-badge-latest";
    badge.textContent = "Latest";
    dateWrap.append(badge);
  }
  item.append(dateWrap);

  const facts = document.createElement("div");
  facts.className = "snapshot-entry-facts";
  appendText(facts, "strong", `${numberFormatter.format(snapshot.row_count)} records`);
  appendText(facts, "span", `CSV · ${formatBytes(snapshot.byte_size)} · Schema v${snapshot.schema_version}`);
  if (detailed) {
    const checksum = appendText(facts, "code", `SHA-256 ${snapshot.sha256}`);
    checksum.title = snapshot.sha256;
  }
  item.append(facts);

  const actions = document.createElement("div");
  actions.className = "snapshot-entry-actions";
  const download = document.createElement("a");
  download.href = new URL(snapshot.csv_path, catalogUrl).href;
  download.textContent = "Download CSV";
  actions.append(download);
  if (detailed) {
    const metadata = document.createElement("a");
    metadata.href = new URL(snapshot.metadata_path, catalogUrl).href;
    metadata.textContent = "Metadata";
    actions.append(metadata);
  }
  item.append(actions);
  return item;
}

async function hydrateSnapshotList(list: HTMLElement): Promise<void> {
  const catalogValue = list.dataset.catalogUrl;
  if (catalogValue === undefined) {
    return;
  }
  const status = list.parentElement?.querySelector<HTMLElement>("[data-open-data-status]");
  try {
    const catalogUrl = new URL(catalogValue, window.location.href);
    const response = await fetch(catalogUrl, { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`Catalog returned ${response.status}.`);
    }
    const catalog = parseCatalog(await response.json());
    const isDetailed = list.dataset.detailed === "true";
    const isCollapsible = list.dataset.collapsible === "true";
    const requestedLimit = Number.parseInt(list.dataset.limit ?? "", 10);
    const initialLimit = Number.parseInt(list.dataset.initialLimit ?? "", 10);

    // Hard limit: only render fixed number of items (e.g. index page data-limit="3")
    if (Number.isSafeInteger(requestedLimit) && requestedLimit > 0) {
      const snapshots = catalog.snapshots.slice(0, requestedLimit);
      list.replaceChildren(...snapshots.map((snapshot, index) =>
        renderSnapshot(snapshot, catalogUrl, isDetailed, index === 0)
      ));
      if (status !== null && status !== undefined) {
        status.textContent = snapshots.length === 0
          ? "The first generated snapshot has not been published yet."
          : `${snapshots.length === 1 ? "One snapshot" : `${snapshots.length} snapshots`} shown.`;
      }
      return;
    }

    const totalCount = catalog.snapshots.length;
    const defaultLimit = Number.isSafeInteger(initialLimit) && initialLimit > 0 ? initialLimit : 5;

    // Collapsible list: initial limit with Show all / Show fewer toggle
    if (isCollapsible && totalCount > defaultLimit) {
      let isExpanded = false;

      let footer = list.parentElement?.querySelector<HTMLElement>("[data-open-data-footer]");
      if (footer === null || footer === undefined) {
        footer = document.createElement("div");
        footer.className = "register-footer";
        footer.dataset.openDataFooter = "";
        list.after(footer);
      }

      const updateView = (): void => {
        const visibleSnapshots = isExpanded
          ? catalog.snapshots
          : catalog.snapshots.slice(0, defaultLimit);

        list.replaceChildren(...visibleSnapshots.map((snapshot, index) =>
          renderSnapshot(snapshot, catalogUrl, isDetailed, index === 0)
        ));

        if (status !== null && status !== undefined) {
          status.textContent = isExpanded
            ? `All ${totalCount} snapshots shown.`
            : `Showing latest ${defaultLimit} of ${totalCount} snapshots.`;
        }

        if (footer !== null && footer !== undefined) {
          footer.replaceChildren();

          const summary = document.createElement("span");
          summary.className = "register-summary";
          summary.textContent = isExpanded
            ? `Showing all ${totalCount} snapshots`
            : `Showing ${defaultLimit} of ${totalCount} snapshots`;
          footer.append(summary);

          const toggleButton = document.createElement("button");
          toggleButton.type = "button";
          toggleButton.className = "register-toggle";
          toggleButton.setAttribute("aria-expanded", isExpanded ? "true" : "false");

          const textSpan = document.createElement("span");
          textSpan.textContent = isExpanded
            ? `Show fewer (${defaultLimit})`
            : `Show all ${totalCount} snapshots`;

          const iconSpan = document.createElement("span");
          iconSpan.className = "toggle-icon";
          iconSpan.setAttribute("aria-hidden", "true");
          iconSpan.textContent = isExpanded ? "↑" : "↓";

          toggleButton.append(textSpan, iconSpan);

          toggleButton.addEventListener("click", () => {
            isExpanded = !isExpanded;
            updateView();
            if (!isExpanded) {
              list.parentElement?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
          });

          footer.append(toggleButton);
        }
      };

      updateView();
      return;
    }

    // Default: render all snapshots
    const snapshots = catalog.snapshots;
    list.replaceChildren(...snapshots.map((snapshot, index) =>
      renderSnapshot(snapshot, catalogUrl, isDetailed, index === 0)
    ));
    if (status !== null && status !== undefined) {
      status.textContent = snapshots.length === 0
        ? "The first generated snapshot has not been published yet."
        : `${snapshots.length === 1 ? "One snapshot" : `${snapshots.length} snapshots`} shown.`;
    }
  } catch {
    if (status !== null && status !== undefined) {
      status.textContent = "The snapshot catalog is temporarily unavailable. Try again shortly.";
    }
  }
}

for (const list of document.querySelectorAll<HTMLElement>("[data-open-data-snapshot-list]")) {
  void hydrateSnapshotList(list);
}
