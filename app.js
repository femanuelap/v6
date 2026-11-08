/* ============================================================
   FANFIC PLAYER — app.js  (PARTE 1/2 — Núcleo & Motor)
   Objeto global FP orquestra toda a aplicação.
   Esta parte cobre: Perfis/IndexedDB, Parser AO3, Detector de
   WIP/Concluída, Importador (arquivo + link) e o Motor epub.js
   (TOC oficial + locations + sincronização ativa).
   A PARTE 2/2 (anotações, seleção, glossário, TTS, skins, zen,
   cofre privado e backup) é anexada ao final deste mesmo
   arquivo no próximo passo.
   ============================================================ */

const FP = {
  profile: null,
  store: null,
  metaStore: null,
  books: [],
  series: [],
  currentBook: null,
  book: null,         // instância epub.js Book
  rendition: null,     // instância epub.js Rendition
  settings: { theme: "light", fontSize: 17, autoNight: false, glossary: [], vaultPin: null },
  currentTab: "todas",
  _tocMap: [],          // lista achatada {href, label} para sincronização ativa

  /* =========================================================
     INICIALIZAÇÃO
     ========================================================= */
  async init() {
    FP.metaStore = localforage.createInstance({ name: "FP_META" });
    await FP.loadProfiles();
    FP.bindCoreUI();
  },

  /* =========================================================
     PERFIS
     ========================================================= */
  async loadProfiles() {
    let profiles = (await FP.metaStore.getItem("profiles")) || [];
    const list = document.getElementById("fp-profile-list");
    list.innerHTML = "";
    if (profiles.length === 0) {
      list.innerHTML = `<p class="fp-empty-note">Nenhum perfil ainda. Crie o seu primeiro!</p>`;
    }
    profiles.forEach((p) => {
      const btn = document.createElement("button");
      btn.innerHTML = `<i class="fa-solid fa-circle-user"></i><span>${FP.escape(p.name)}</span>`;
      btn.onclick = () => FP.selectProfile(p);
      list.appendChild(btn);
    });

    document.getElementById("fp-new-profile-btn").onclick = async () => {
      const name = prompt("Nome do novo perfil:");
      if (!name) return;
      const profs = (await FP.metaStore.getItem("profiles")) || [];
      const p = { id: "p_" + Date.now(), name: name.trim() };
      profs.push(p);
      await FP.metaStore.setItem("profiles", profs);
      await FP.loadProfiles();
      FP.selectProfile(p);
    };
  },

  async selectProfile(p) {
    FP.profile = p;
    FP.store = localforage.createInstance({ name: "FP_" + p.id });

    document.getElementById("fp-profile-screen").classList.add("hidden");
    document.getElementById("fp-app").classList.remove("hidden");
    document.getElementById("fp-sidebar-profile-name").textContent = p.name;

    FP.settings = Object.assign(FP.settings, (await FP.store.getItem("settings")) || {});
    FP.series = (await FP.store.getItem("series")) || [];

    if (typeof FP.applyTheme === "function") FP.applyTheme(FP.settings.theme);
    if (typeof FP.applyFontSize === "function") FP.applyFontSize(FP.settings.fontSize);
    if (typeof FP.checkAutoNight === "function") FP.checkAutoNight();

    await FP.loadBooks();
    FP.renderDashboard();
  },

  /* =========================================================
     UI NÚCLEO (sidebar, tabs, modais, dashboard, importação)
     ========================================================= */
  bindCoreUI() {
    // Sidebar (drawer no mobile)
    const sidebar = document.getElementById("fp-sidebar");
    const overlay = document.getElementById("fp-sidebar-overlay");
    const openSidebar = () => { sidebar.classList.add("open"); overlay.classList.remove("hidden"); };
    const closeSidebar = () => { sidebar.classList.remove("open"); overlay.classList.add("hidden"); };
    document.getElementById("fp-open-sidebar-btn").onclick = openSidebar;
    document.getElementById("fp-sidebar-close-btn").onclick = closeSidebar;
    overlay.onclick = closeSidebar;

    document.getElementById("fp-sidebar-switch-profile-btn").onclick = () => {
      document.getElementById("fp-app").classList.add("hidden");
      document.getElementById("fp-view-reader").classList.add("hidden");
      document.getElementById("fp-profile-screen").classList.remove("hidden");
    };
    document.getElementById("fp-sidebar-profile-btn").onclick = () => {
      document.getElementById("fp-sidebar-switch-profile-btn").click();
    };

    // Fecha qualquer modal
    document.querySelectorAll(".fp-close-modal").forEach((b) => {
      b.onclick = (e) => e.target.closest(".fp-modal-backdrop").classList.add("hidden");
    });

    // Tabs (sidebar + versão mobile) — sincronizadas
    document.querySelectorAll(".fp-tab").forEach((t) => {
      t.onclick = () => {
        document.querySelectorAll(".fp-tab").forEach((x) => x.classList.remove("active"));
        document.querySelectorAll(`.fp-tab[data-tab="${t.dataset.tab}"]`).forEach((x) => x.classList.add("active"));
        FP.currentTab = t.dataset.tab;
        FP.renderDashboard();
        closeSidebar();
      };
    });

    document.getElementById("fp-search-input").oninput = () => FP.renderDashboard();

    // Importação
    const openImport = () => {
      document.getElementById("fp-import-modal").classList.remove("hidden");
      document.getElementById("fp-import-preview").classList.add("hidden");
      document.getElementById("fp-import-confirm-btn").classList.add("hidden");
    };
    document.getElementById("fp-import-btn-top").onclick = openImport;

    document.querySelectorAll('[data-importtab]').forEach((t) => {
      t.onclick = () => {
        document.querySelectorAll('[data-importtab]').forEach((x) => x.classList.remove("active"));
        t.classList.add("active");
        const tab = t.dataset.importtab;
        document.getElementById("fp-import-arquivo").classList.toggle("hidden", tab !== "arquivo");
        document.getElementById("fp-import-link").classList.toggle("hidden", tab !== "link");
      };
    });

    document.getElementById("fp-file-input").onchange = (e) => FP.handleFileImport(e.target.files[0]);
    document.getElementById("fp-ao3-fetch-btn").onclick = () => FP.handleAO3Import();

    // Reader toolbar
    document.getElementById("fp-reader-back-btn").onclick = () => FP.showDashboard();
    document.getElementById("fp-toc-btn").onclick = () => document.getElementById("fp-toc-modal").classList.remove("hidden");

    // Detalhe do livro
    document.getElementById("fp-detail-open-btn").onclick = () => FP.openReader(FP._detailBookId);
    document.getElementById("fp-detail-delete-btn").onclick = () => FP.deleteBook(FP._detailBookId);
    document.getElementById("fp-detail-fav-btn").onclick = () => FP.toggleFavorite(FP._detailBookId);
    document.getElementById("fp-detail-status").onchange = (e) => FP.setStatus(FP._detailBookId, e.target.value);
    document.getElementById("fp-detail-series").onchange = (e) => FP.setSeries(FP._detailBookId, e.target.value);
    document.getElementById("fp-detail-new-series-btn").onclick = () => document.getElementById("fp-series-modal").classList.remove("hidden");
    document.getElementById("fp-series-save-btn").onclick = () => FP.createSeries();
  },

  showDashboard() {
    document.getElementById("fp-view-reader").classList.add("hidden");
    document.getElementById("fp-view-dashboard").classList.remove("hidden");
    document.getElementById("fp-app").classList.remove("zen");
    FP.renderDashboard();
  },

  escape(s) { const d = document.createElement("div"); d.textContent = s || ""; return d.innerHTML; },

  toast(msg) {
    const t = document.getElementById("fp-toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(FP._toastTimer);
    FP._toastTimer = setTimeout(() => t.classList.add("hidden"), 2200);
  },

  /* =========================================================
     LIVROS / BIBLIOTECA (persistência)
     ========================================================= */
  async loadBooks() { FP.books = (await FP.store.getItem("books")) || []; },
  async saveBooks() { await FP.store.setItem("books", FP.books); },
  async saveSeries() { await FP.store.setItem("series", FP.series); },

  /* =========================================================
     RENDERIZAÇÃO DO DASHBOARD
     ========================================================= */
  renderDashboard() {
    const grid = document.getElementById("fp-book-grid");
    const notesList = document.getElementById("fp-notes-list");
    const seriesView = document.getElementById("fp-series-view");
    const query = document.getElementById("fp-search-input").value.toLowerCase().trim();

    // Widget Continue Lendo
    const visibleBooks = FP.books.filter((b) => !b.inVault);
    const lastRead = [...visibleBooks].filter((b) => b.progress && b.progress.pct > 0)
      .sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0))[0];
    const widget = document.getElementById("fp-continue-widget");
    if (lastRead) {
      widget.classList.remove("hidden");
      document.getElementById("fp-continue-content").innerHTML = `
        <div class="fp-continue-cover"><i class="fa-solid fa-book"></i></div>
        <div class="fp-continue-info">
          <p class="fp-continue-info-title">${FP.escape(lastRead.title)}</p>
          <p class="fp-continue-info-chapter">${FP.escape(lastRead.progress.chapterTitle || "")}</p>
          <div class="fp-progress-bar-track"><div class="fp-progress-bar-fill" style="width:${Math.round((lastRead.progress.pct || 0) * 100)}%"></div></div>
        </div>`;
      document.getElementById("fp-continue-content").onclick = () => FP.openReader(lastRead.id);
    } else {
      widget.classList.add("hidden");
    }

    // Aba "Minhas Anotações" (implementada na Parte 2)
    if (FP.currentTab === "anotacoes") {
      grid.classList.add("hidden"); seriesView.classList.add("hidden"); notesList.classList.remove("hidden");
      document.getElementById("fp-empty-msg").classList.add("hidden");
      if (typeof FP.extRenderAllNotes === "function") FP.extRenderAllNotes(notesList);
      else notesList.innerHTML = `<p class="fp-empty-msg">Carregando módulo de anotações...</p>`;
      return;
    }

    // Aba "Séries / Coleções"
    if (FP.currentTab === "series") {
      grid.classList.add("hidden"); notesList.classList.add("hidden"); seriesView.classList.remove("hidden");
      FP.renderSeriesView(query);
      return;
    }

    grid.classList.remove("hidden"); notesList.classList.add("hidden"); seriesView.classList.add("hidden");

    let filtered = visibleBooks.filter((b) => {
      if (FP.currentTab === "lendo" && b.status !== "lendo") return false;
      if (FP.currentTab === "querer" && b.status !== "querer") return false;
      if (FP.currentTab === "favoritas" && !b.favorite) return false;
      if (query) {
        const hay = [b.title, b.author, b.fandom, (b.tags || []).join(" "), (b.ships || []).join(" ")].join(" ").toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    grid.innerHTML = "";
    document.getElementById("fp-empty-msg").classList.toggle("hidden", filtered.length > 0);

    filtered.forEach((b) => grid.appendChild(FP.renderBookCard(b)));
  },

  renderBookCard(b) {
    const card = document.createElement("div");
    card.className = "fp-book-card";
    const statusBadge = b.wip === false
      ? `<span class="fp-badge fp-badge--done">🟢 Concluída</span>`
      : `<span class="fp-badge fp-badge--wip">🟡 WIP</span>`;
    card.innerHTML = `
      <div class="fp-book-card-cover"><i class="fa-solid fa-book-open"></i></div>
      <div class="fp-book-card-body">
        <p class="fp-book-card-title">${FP.escape(b.title)}</p>
        <p class="fp-book-card-author">${FP.escape(b.author || "Autor desconhecido")}</p>
        <div class="fp-book-card-footer">${statusBadge}${b.favorite ? '<i class="fa-solid fa-heart" style="color:var(--fp-red);font-size:11px"></i>' : ""}</div>
      </div>`;
    card.onclick = () => FP.openBookDetail(b.id);
    return card;
  },

  renderSeriesView(query) {
    const list = document.getElementById("fp-series-list");
    list.innerHTML = "";
    if (FP.series.length === 0) {
      list.innerHTML = `<p class="fp-empty-msg">Nenhuma série criada ainda. Abra uma fanfic e use "Nova Série" para organizar seu universo.</p>`;
      return;
    }
    FP.series.forEach((s) => {
      const booksInSeries = FP.books.filter((b) => b.seriesId === s.id && !b.inVault);
      const card = document.createElement("div");
      card.className = "fp-series-card";
      card.innerHTML = `<p class="fp-series-card-title"><i class="fa-solid fa-sitemap"></i> ${FP.escape(s.name)}</p>
        <p class="fp-series-card-count">${booksInSeries.length} obra(s)</p>`;
      card.onclick = () => {
        const grid = document.createElement("div");
        grid.className = "fp-book-grid";
        grid.style.marginTop = "10px";
        booksInSeries.forEach((b) => grid.appendChild(FP.renderBookCard(b)));
        const existing = card.querySelector(".fp-book-grid");
        if (existing) existing.remove(); else card.appendChild(grid);
      };
      list.appendChild(card);
    });
  },

  /* =========================================================
     DETALHE DO LIVRO
     ========================================================= */
  openBookDetail(id) {
    const b = FP.books.find((x) => x.id === id);
    if (!b) return;
    FP._detailBookId = id;
    document.getElementById("fp-detail-title").textContent = b.title;
    document.getElementById("fp-detail-author").textContent = b.author || "";
    document.getElementById("fp-detail-summary").textContent = b.summary || "Sem resumo disponível.";
    document.getElementById("fp-detail-status").value = b.status || "querer";

    const favBtn = document.getElementById("fp-detail-fav-btn");
    favBtn.innerHTML = b.favorite
      ? '<i class="fa-solid fa-heart" style="color:var(--fp-red)"></i> Favoritada'
      : '<i class="fa-regular fa-heart"></i> Favoritar';

    const seriesSelect = document.getElementById("fp-detail-series");
    seriesSelect.innerHTML = `<option value="">Sem série / coleção</option>` +
      FP.series.map((s) => `<option value="${s.id}">${FP.escape(s.name)}</option>`).join("");
    seriesSelect.value = b.seriesId || "";

    const vaultBtn = document.getElementById("fp-detail-vault-btn");
    vaultBtn.innerHTML = b.inVault
      ? '<i class="fa-solid fa-lock-open"></i> Remover do Cofre Secreto'
      : '<i class="fa-solid fa-user-lock"></i> Mover para o Cofre Secreto';

    const badges = document.getElementById("fp-detail-badges");
    badges.innerHTML = "";
    [b.rating, b.category, ...(b.warnings || [])].filter(Boolean).forEach((x) => {
      badges.innerHTML += `<span class="fp-badge fp-badge--outline">${FP.escape(x)}</span>`;
    });
    badges.innerHTML += b.wip === false
      ? `<span class="fp-badge fp-badge--done">🟢 ${b.chaptersDone || "?"}/${b.chaptersTotal || "?"}</span>`
      : `<span class="fp-badge fp-badge--wip">🟡 ${b.chaptersDone || "?"}/${b.chaptersTotal || "?"}</span>`;

    const tagsEl = document.getElementById("fp-detail-tags");
    tagsEl.innerHTML = "";
    [...(b.ships || []), ...(b.characters || []), ...(b.tags || [])].forEach((t) => {
      tagsEl.innerHTML += `<span>${FP.escape(t)}</span>`;
    });

    document.getElementById("fp-detail-modal").classList.remove("hidden");
  },

  async toggleFavorite(id) {
    const b = FP.books.find((x) => x.id === id);
    b.favorite = !b.favorite;
    await FP.saveBooks();
    FP.openBookDetail(id);
    FP.renderDashboard();
  },
  async setStatus(id, status) {
    const b = FP.books.find((x) => x.id === id);
    b.status = status;
    await FP.saveBooks();
    FP.renderDashboard();
  },
  async setSeries(id, seriesId) {
    const b = FP.books.find((x) => x.id === id);
    b.seriesId = seriesId || null;
    await FP.saveBooks();
  },
  async createSeries() {
    const input = document.getElementById("fp-series-name-input");
    const name = input.value.trim();
    if (!name) return;
    const s = { id: "s_" + Date.now(), name };
    FP.series.push(s);
    await FP.saveSeries();
    input.value = "";
    document.getElementById("fp-series-modal").classList.add("hidden");
    FP.openBookDetail(FP._detailBookId);
    FP.toast("Série criada!");
  },
  async deleteBook(id) {
    if (!confirm("Remover esta fanfic da biblioteca?")) return;
    FP.books = FP.books.filter((b) => b.id !== id);
    await FP.saveBooks();
    await FP.store.removeItem("file_" + id);
    await FP.store.removeItem("annotations_" + id);
    document.getElementById("fp-detail-modal").classList.add("hidden");
    FP.renderDashboard();
  },

  /* =========================================================
     PARSER AUTOMÁTICO DE METADADOS DO AO3
     ========================================================= */
  parseAO3Html(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const text = (sel) => { const el = doc.querySelector(sel); return el ? el.textContent.trim() : ""; };
    const listText = (sel) => Array.from(doc.querySelectorAll(sel)).map((e) => e.textContent.trim());

    const title = text("h2.title") || text(".title.heading") || doc.title || "Fanfic sem título";
    const author = text("a[rel=author]") || "Autor Anônimo";
    const summary = (doc.querySelector(".summary .userstuff") || {}).textContent?.trim() || "";
    const fandom = listText("dd.fandom a, .fandom a").join(", ");
    const rating = listText("dd.rating a, .rating a")[0] || "";
    const warnings = listText("dd.warning a, .warnings a");
    const category = listText("dd.category a, .category a").join(", ");
    const ships = listText("dd.relationship a, .relationships a");
    const characters = listText("dd.character a, .characters a");
    const tags = listText("dd.freeform a, .freeforms a");

    // --- Detector de Status (Concluída vs WIP) ---
    // Validação estrita do formato "X/Y" (ou "X/?") para evitar bugs de
    // concatenação (ex.: "5" + "5" virando "55") quando a "/" se perde
    // na extração de textContent de marcações variantes do AO3.
    let chaptersDone = 1, chaptersTotal = "?";
    const chaptersRaw = (text("dd.chapters") || text(".chapters") || "").replace(/\s+/g, "");
    let chapMatch = chaptersRaw.match(/^(\d+)\/(\d+|\?)$/);
    if (!chapMatch) {
      // Fallback 1: procura o padrão "Chapters: X/Y" em todo o texto da página
      const bodyText = (doc.body ? doc.body.textContent : "").replace(/\s+/g, " ");
      chapMatch = bodyText.match(/Chapters:\s*(\d+)\s*\/\s*(\d+|\?)/i);
    }
    if (chapMatch) {
      chaptersDone = parseInt(chapMatch[1], 10) || 1;
      chaptersTotal = (chapMatch[2] === "?") ? "?" : parseInt(chapMatch[2], 10);
    }
    // Fallback 2 / validação cruzada: confere contra a contagem real de
    // <div class="chapter"> presentes no HTML — fonte da verdade mais
    // confiável do que qualquer string de metadados mal-formada.
    const realChapterCount = doc.querySelectorAll(".chapter").length;
    if (realChapterCount > 0 && realChapterCount !== chaptersDone) {
      chaptersDone = realChapterCount;
      if (chaptersTotal !== "?" && chaptersTotal < realChapterCount) chaptersTotal = realChapterCount;
    }
    const wip = !(chaptersTotal !== "?" && chaptersTotal === chaptersDone);

    return {
      title, author, summary, fandom, rating, category,
      warnings, ships, characters, tags,
      chaptersDone, chaptersTotal, wip
    };
  },

  async handleAO3Import() {
    const url = document.getElementById("fp-ao3-url").value.trim();
    const pastedHtml = document.getElementById("fp-ao3-html").value.trim();
    let html = pastedHtml;
    if (!html && url) {
      try {
        const res = await fetch(url);
        html = await res.text();
      } catch (e) {
        FP.toast("CORS bloqueou o acesso direto. Cole o HTML da página manualmente.");
        return;
      }
    }
    if (!html) { FP.toast("Informe um link ou cole o HTML da página."); return; }

    const meta = FP.parseAO3Html(html);

    // --- Rastreador de Atualizações (re-importação de WIP) ---
    const existing = FP.books.find((b) => b.title === meta.title && b.author === meta.author);
    if (existing && typeof meta.chaptersDone === "number" && meta.chaptersDone > (existing.chaptersDone || 0)) {
      FP.toast(`📢 Novo(s) capítulo(s) detectado(s) em "${existing.title}"! (${existing.chaptersDone} → ${meta.chaptersDone})`);
      existing.chaptersDone = meta.chaptersDone;
      existing.chaptersTotal = meta.chaptersTotal;
      existing.wip = meta.wip;
      await FP.saveBooks();
      document.getElementById("fp-import-modal").classList.add("hidden");
      FP.renderDashboard();
      return;
    }
    if (existing && meta.chaptersDone <= (existing.chaptersDone || 0)) {
      FP.toast(`Nenhum capítulo novo em "${existing.title}".`);
      document.getElementById("fp-import-modal").classList.add("hidden");
      return;
    }

    FP._pendingImport = { meta, format: "html", html };
    FP.showImportPreview(meta);
  },

  showImportPreview(meta) {
    const prev = document.getElementById("fp-import-preview");
    prev.classList.remove("hidden");
    prev.innerHTML = `
      <b>${FP.escape(meta.title)}</b>
      <span>${FP.escape(meta.author)} · ${FP.escape(meta.fandom)}</span>
      <span>${FP.escape(meta.rating)} · ${meta.wip ? "🟡 WIP" : "🟢 Concluída"} (${meta.chaptersDone}/${meta.chaptersTotal})</span>
      <span style="color:var(--fp-muted)">${FP.escape((meta.summary || "").slice(0, 180))}${(meta.summary || "").length > 180 ? "..." : ""}</span>`;
    const confirmBtn = document.getElementById("fp-import-confirm-btn");
    confirmBtn.classList.remove("hidden");
    confirmBtn.onclick = () => FP.confirmImport();
  },

  async confirmImport() {
    const pending = FP._pendingImport;
    if (!pending) return;
    const id = "b_" + Date.now();

    const book = Object.assign({
      id, status: "querer", favorite: false, seriesId: null, inVault: false,
      format: pending.format || "html", addedAt: Date.now()
    }, pending.meta);

    if (pending.format === "epub" || pending.format === "pdf") {
      await FP.store.setItem("file_" + id, pending.fileData);
    } else if (pending.format === "txt") {
      await FP.store.setItem("file_" + id, { type: "txt", content: pending.textContent || "" });
    } else {
      await FP.store.setItem("file_" + id, { type: "html", content: pending.html || "" });
    }

    FP.books.push(book);
    await FP.saveBooks();
    document.getElementById("fp-import-modal").classList.add("hidden");
    document.getElementById("fp-ao3-url").value = "";
    document.getElementById("fp-ao3-html").value = "";
    document.getElementById("fp-file-input").value = "";
    FP.toast("Fanfic adicionada à biblioteca!");
    FP.renderDashboard();
  },

  /* =========================================================
     IMPORTAÇÃO POR ARQUIVO (EPUB / PDF / TXT)
     ========================================================= */
  async handleFileImport(file) {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    const buffer = await file.arrayBuffer();

    if (ext === "epub") {
      try {
        const tmpBook = ePub(buffer.slice(0));
        await tmpBook.ready;
        const meta = await tmpBook.loaded.metadata;
        const nav = await tmpBook.loaded.navigation;
        const chapTotal = (nav.toc || []).length || 1;

        // Tenta extrair metadados AO3 do primeiro capítulo (caso o EPUB tenha sido exportado do AO3)
        let ao3Extra = {};
        try {
          const firstHref = (nav.toc[0] || {}).href;
          if (firstHref) {
            const section = tmpBook.spine.get(firstHref);
            await section.load(tmpBook.load.bind(tmpBook));
            const html = section.document.documentElement.outerHTML;
            const parsed = FP.parseAO3Html(html);
            if (parsed.fandom || parsed.ships.length) ao3Extra = parsed;
            section.unload();
          }
        } catch (e) { /* EPUB não contém metadados AO3 — segue apenas com metadata.opf */ }

        FP._pendingImport = {
          format: "epub",
          fileData: buffer,
          meta: Object.assign({
            title: meta.title || file.name,
            author: meta.creator || "Autor desconhecido",
            summary: meta.description || "",
            fandom: "", rating: "", category: "", warnings: [], ships: [], characters: [], tags: [],
            chaptersDone: chapTotal, chaptersTotal: chapTotal, wip: false
          }, ao3Extra)
        };
        FP.showImportPreview(FP._pendingImport.meta);
      } catch (e) {
        console.error(e);
        FP.toast("Erro ao ler o EPUB.");
      }
    } else if (ext === "pdf") {
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        const pdf = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
        FP._pendingImport = {
          format: "pdf",
          fileData: buffer,
          meta: {
            title: file.name.replace(/\.pdf$/i, ""),
            author: "Autor desconhecido", summary: `PDF com ${pdf.numPages} páginas.`,
            fandom: "", rating: "", category: "", warnings: [], ships: [], characters: [], tags: [],
            chaptersDone: pdf.numPages, chaptersTotal: pdf.numPages, wip: false
          }
        };
        FP.showImportPreview(FP._pendingImport.meta);
      } catch (e) {
        FP.toast("Erro ao ler o PDF.");
      }
    } else if (ext === "txt") {
      const text = new TextDecoder("utf-8").decode(buffer);
      FP._pendingImport = {
        format: "txt",
        textContent: text,
        meta: {
          title: file.name.replace(/\.txt$/i, ""),
          author: "Autor desconhecido", summary: text.slice(0, 200) + "...",
          fandom: "", rating: "", category: "", warnings: [], ships: [], characters: [], tags: [],
          chaptersDone: 1, chaptersTotal: 1, wip: false
        }
      };
      FP.showImportPreview(FP._pendingImport.meta);
    } else {
      FP.toast("Formato não suportado.");
    }
  },

  /* =========================================================
     MOTOR DE LEITURA — epub.js renderizado no DOM
     ========================================================= */
  async openReader(id) {
    const b = FP.books.find((x) => x.id === id);
    if (!b) return;
    FP.currentBook = b;
    b.lastOpened = Date.now();
    await FP.saveBooks();

    document.getElementById("fp-detail-modal").classList.add("hidden");
    document.getElementById("fp-view-dashboard").classList.add("hidden");
    document.getElementById("fp-view-reader").classList.remove("hidden");
    document.getElementById("fp-reader-title").textContent = b.title;

    const container = document.getElementById("reader-content");
    container.innerHTML = `<p style="text-align:center;color:var(--fp-muted)">Carregando...</p>`;

    const fileData = await FP.store.getItem("file_" + id);

    if (b.format === "epub") {
      await FP.renderEpub(fileData, b);
    } else if (b.format === "pdf") {
      await FP.renderPdf(fileData, b, container);
    } else {
      // Formatos "html" (AO3 colado) e "txt": capítulos reais + TOC funcional
      await FP.renderHtmlBook(fileData, b, container);
    }

    document.dispatchEvent(new CustomEvent("fp:bookOpened", { detail: { book: b } }));
  },

  async renderEpub(arrayBuffer, b) {
    const container = document.getElementById("reader-content");
    container.innerHTML = "";

    // Renderização direta no DOM (não em iframe) para permitir tradução
    // nativa do navegador e seleção de texto — flow contínuo e scrollado.
    FP.book = ePub(arrayBuffer.slice ? arrayBuffer.slice(0) : arrayBuffer);
    FP.rendition = FP.book.renderTo(container, {
      width: "100%",
      height: "auto",
      flow: "scrolled-doc",
      manager: "continuous"
    });

    // --- TOC Oficial via book.loaded.navigation (nunca via spine) ---
    const nav = await FP.book.loaded.navigation;
    FP._tocMap = FP.flattenTOC(nav.toc || []);
    FP.renderTOC(nav.toc || []);

    const storedLoc = b.progress && b.progress.cfi;
    await FP.rendition.display(storedLoc || undefined);

    // --- Sincronização ativa: evento customizado fp:relocated ---
    FP.rendition.on("relocated", (location) => {
      const pct = (FP.book.locations && FP.book.locations.length())
        ? FP.book.locations.percentageFromCfi(location.start.cfi) : 0;

      const navItem = FP.book.navigation && FP.book.navigation.get
        ? FP.book.navigation.get(location.start.href) : null;
      const chapterTitle = navItem ? navItem.label.trim() : "";

      document.getElementById("fp-reader-chapter").textContent = chapterTitle;
      document.getElementById("fp-progress-label").textContent = Math.round(pct * 100) + "%";
      document.getElementById("fp-progress-slider").value = Math.round(pct * 1000);
      FP.updateTimeRemaining(pct);
      FP.highlightActiveTOC(location.start.href);

      b.progress = { cfi: location.start.cfi, pct, chapterTitle };
      FP.saveBooks();

      document.dispatchEvent(new CustomEvent("fp:relocated", { detail: { location, pct, chapterTitle } }));
    });

    // --- book.locations.generate(1600) após book.ready ---
    FP.book.ready.then(() => FP.book.locations.generate(1600)).catch(() => {});

    FP.rendition.on("rendered", () => {
      if (typeof FP.applyFontSize === "function") FP.applyFontSize(FP.settings.fontSize);
      if (typeof FP.setupAnnotatableParagraphs === "function") FP.setupAnnotatableParagraphs();
      if (typeof FP.bindSelectionPopover === "function") FP.bindSelectionPopover();
    });

    document.getElementById("fp-progress-slider").addEventListener("change", (e) => {
      const target = parseInt(e.target.value) / 1000;
      if (FP.book.locations && FP.book.locations.length()) {
        FP.rendition.display(FP.book.locations.cfiFromPercentage(target));
      }
    });
  },

  async renderPdf(arrayBuffer, b, container) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
    let html = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((it) => it.str).join(" ");
      html += `<p data-page="${i}">${FP.escape(pageText)}</p>`;
    }
    container.innerHTML = html;
    if (typeof FP.setupAnnotatableParagraphs === "function") FP.setupAnnotatableParagraphs();
    document.getElementById("fp-reader-chapter").textContent = `${pdf.numPages} páginas`;
    FP.restoreScrollProgress(b);
    FP.bindReaderScrollProgress();
  },

  /* =========================================================
     CAPÍTULOS REAIS + TOC FUNCIONAL (formatos "html" do AO3 e "txt")
     Corrige dois bugs: (1) contagem errada de capítulos ao importar
     (ex.: "5" virando "55"); (2) índice que não navega para o
     capítulo clicado. Também separa o conteúdo real da fic do bloco
     de metadados/preface (resumo, notas), que fica só na ficha do livro.
     ========================================================= */
  extractAO3Chapters(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const work = doc.querySelector("#workskin") || doc.querySelector(".userstuff") || doc.body;
    if (!work) return [{ title: "Capítulo Único", html: "<p>Conteúdo não encontrado.</p>" }];

    const chapterDivs = Array.from(work.querySelectorAll(".chapter"));

    if (chapterDivs.length > 1) {
      // Obra com múltiplos capítulos (<div class="chapter"> por capítulo no HTML
      // exportado do AO3) — cada um vira uma seção própria com âncora no TOC.
      return chapterDivs.map((div, i) => {
        const titleEl = div.querySelector("h3.title a, h3.title, h2.heading");
        const title = titleEl ? titleEl.textContent.trim() : `Capítulo ${i + 1}`;
        const body = div.querySelector(".userstuff.module, .userstuff") || div;
        return { title, html: body.innerHTML };
      });
    }
    if (chapterDivs.length === 1) {
      // Obra de capítulo único já embrulhada em <div class="chapter"> —
      // pega só o corpo (.userstuff), descartando a caixa de preface/notas.
      const body = chapterDivs[0].querySelector(".userstuff.module, .userstuff") || chapterDivs[0];
      return [{ title: "Capítulo Único", html: body.innerHTML }];
    }
    // Sem <div class="chapter"> — remove manualmente as caixas de preface
    // (resumo/notas) antes de extrair o corpo, para não misturar metadados
    // com o texto da história.
    const clone = work.cloneNode(true);
    clone.querySelectorAll(".preface, .meta, .notes").forEach((el) => el.remove());
    const body = clone.querySelector(".userstuff.module, .userstuff") || clone;
    return [{ title: "Capítulo Único", html: body.innerHTML || "<p>Conteúdo não encontrado.</p>" }];
  },

  async renderHtmlBook(fileData, b, container) {
    let chapters;
    if (b.format === "html") {
      chapters = FP.extractAO3Chapters((fileData && fileData.content) || "");
    } else {
      const text = (fileData && fileData.content) || "";
      const html = text.split(/\n{2,}/).map((p) => `<p>${FP.escape(p)}</p>`).join("");
      chapters = [{ title: "Capítulo Único", html }];
    }

    container.innerHTML = chapters.map((c, i) => `
      <section class="fp-chapter" id="fpchap-${i}" data-title="${FP.escape(c.title)}">
        <h2 class="fp-chapter-heading">${FP.escape(c.title)}</h2>
        ${c.html}
      </section>`).join("");

    FP._htmlChapters = chapters;
    FP.renderHtmlTOC(chapters);

    if (typeof FP.setupAnnotatableParagraphs === "function") FP.setupAnnotatableParagraphs();

    FP.restoreScrollProgress(b);
    FP.bindHtmlChapterTracking(b);
  },

  // TOC para capítulos "html"/"txt" — clicar rola até a âncora real do capítulo
  renderHtmlTOC(chapters) {
    const list = document.getElementById("fp-toc-list");
    list.innerHTML = "";
    chapters.forEach((c, i) => {
      const row = document.createElement("button");
      row.className = "fp-toc-item";
      row.dataset.chapTitle = c.title;
      row.textContent = c.title;
      row.onclick = () => {
        const target = document.getElementById("fpchap-" + i);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        document.getElementById("fp-toc-modal").classList.add("hidden");
      };
      list.appendChild(row);
    });
    if (chapters.length) FP.highlightActiveTOC(null, chapters[0].title);
  },

  // Sincronização ativa por rolagem (equivalente ao "relocated" do epub.js,
  // mas para conteúdo HTML renderizado diretamente, sem iframe/paginação).
  bindHtmlChapterTracking(b) {
    const scrollEl = document.getElementById("fp-reader-scroll");
    const sections = Array.from(document.querySelectorAll(".fp-chapter"));

    const updateActive = () => {
      const scrollTop = scrollEl.scrollTop;
      const anchorY = scrollEl.getBoundingClientRect().top + 80;
      let current = sections[0];
      sections.forEach((sec) => { if (sec.getBoundingClientRect().top <= anchorY) current = sec; });
      const title = current ? current.dataset.title : "";
      document.getElementById("fp-reader-chapter").textContent = title;
      FP.highlightActiveTOC(null, title);

      const pct = scrollEl.scrollTop / (scrollEl.scrollHeight - scrollEl.clientHeight || 1);
      document.getElementById("fp-progress-label").textContent = Math.round(pct * 100) + "%";
      document.getElementById("fp-progress-slider").value = Math.round(pct * 1000);
      FP.updateTimeRemaining(pct);

      b.progress = Object.assign(b.progress || {}, { pct, scrollTop, chapterTitle: title });
      clearTimeout(FP._scrollSaveTimer);
      FP._scrollSaveTimer = setTimeout(() => FP.saveBooks(), 600);

      document.dispatchEvent(new CustomEvent("fp:relocated", { detail: { pct, chapterTitle: title } }));
    };

    scrollEl.onscroll = updateActive;
    document.getElementById("fp-progress-slider").oninput = (e) => {
      const target = parseInt(e.target.value) / 1000;
      scrollEl.scrollTop = target * (scrollEl.scrollHeight - scrollEl.clientHeight);
    };
    updateActive();
  },

  restoreScrollProgress(b) {
    if (b.progress && b.progress.scrollTop) {
      requestAnimationFrame(() => { document.getElementById("fp-reader-scroll").scrollTop = b.progress.scrollTop; });
    }
  },
  bindReaderScrollProgress() {
    const scrollEl = document.getElementById("fp-reader-scroll");
    scrollEl.onscroll = () => {
      const pct = scrollEl.scrollTop / (scrollEl.scrollHeight - scrollEl.clientHeight || 1);
      document.getElementById("fp-progress-label").textContent = Math.round(pct * 100) + "%";
      document.getElementById("fp-progress-slider").value = Math.round(pct * 1000);
      FP.updateTimeRemaining(pct);
      FP.currentBook.progress = Object.assign(FP.currentBook.progress || {}, { pct, scrollTop: scrollEl.scrollTop });
      clearTimeout(FP._scrollSaveTimer);
      FP._scrollSaveTimer = setTimeout(() => FP.saveBooks(), 600);
    };
    document.getElementById("fp-progress-slider").oninput = (e) => {
      const target = parseInt(e.target.value) / 1000;
      scrollEl.scrollTop = target * (scrollEl.scrollHeight - scrollEl.clientHeight);
    };
  },

  // --- Métrica: tempo estimado restante (baseado em ~200 palavras/min) ---
  updateTimeRemaining(pct) {
    const container = document.getElementById("reader-content");
    const totalWords = (container.textContent || "").trim().split(/\s+/).length;
    const remainingWords = Math.max(0, totalWords * (1 - pct));
    const minutes = Math.ceil(remainingWords / 200);
    const label = document.getElementById("fp-time-remaining");
    if (label) label.textContent = minutes <= 1 ? "<1 min" : `~${minutes} min`;
  },

  /* ---------------- TOC (Sumário) ---------------- */
  flattenTOC(toc, acc = []) {
    toc.forEach((item) => {
      acc.push({ href: item.href, label: item.label.trim() });
      if (item.subitems && item.subitems.length) FP.flattenTOC(item.subitems, acc);
    });
    return acc;
  },

  renderTOC(toc) {
    const list = document.getElementById("fp-toc-list");
    list.innerHTML = "";
    const renderItems = (items, depth) => {
      items.forEach((item) => {
        const row = document.createElement("button");
        row.className = "fp-toc-item";
        row.dataset.href = item.href;
        row.style.paddingLeft = (depth * 14 + 6) + "px";
        row.textContent = item.label.trim();
        row.onclick = () => {
          FP.rendition.display(item.href);
          document.getElementById("fp-toc-modal").classList.add("hidden");
        };
        list.appendChild(row);
        if (item.subitems && item.subitems.length) renderItems(item.subitems, depth + 1);
      });
    };
    renderItems(toc, 0);
  },

  // Destaca o capítulo ativo no TOC em tempo real conforme a rolagem (relocated)
  highlightActiveTOC(href) {
    document.querySelectorAll(".fp-toc-item").forEach((el) => {
      el.classList.toggle("active", el.dataset.href === href || (href || "").startsWith(el.dataset.href));
    });
  },

  // Ganchos preenchidos pela Parte 2/2 (anotações, seleção, glossário, TTS, skins...)
  setupAnnotatableParagraphs() { if (typeof FP.extSetupAnnotations === "function") FP.extSetupAnnotations(); },
  bindSelectionPopover() { if (typeof FP.extBindSelectionPopover === "function") FP.extBindSelectionPopover(); }
};

document.addEventListener("DOMContentLoaded", FP.init);

/* ======= FIM DA PARTE 1/2 ======= */

/* ============================================================
   FANFIC PLAYER — app.js  (PARTE 2/2 — Ferramentas Avançadas)
   Anexado ao objeto global FP definido na Parte 1/2.
   Cobre: Anotações/Comentários por parágrafo, Seleção
   Inteligente (popover), Glossário Anti-Tradução, Modo
   Audiobook (TTS), Skins, Modo Noturno Automático, Modo Foco
   (Zen), Cofre Secreto (PIN) e Cofre de Backup (JSON).
   ============================================================ */

(function () {

  /* =========================================================
     SKINS / TEMA
     ========================================================= */
  FP.applyTheme = function (theme, persist) {
    FP.settings.theme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    document.querySelectorAll(".fp-theme-opt").forEach((b) => {
      b.classList.toggle("active", b.dataset.themeOpt === theme);
    });
    if (persist) FP.saveSettings();
  };

  FP.applyFontSize = function (size, persist) {
    size = Math.max(12, Math.min(28, size));
    FP.settings.fontSize = size;
    const rc = document.getElementById("reader-content");
    if (rc) rc.style.fontSize = size + "px";
    const label = document.getElementById("fp-font-size-label");
    if (label) label.textContent = size + "px";
    if (persist) FP.saveSettings();
  };

  // Modo Noturno Automático: ativa o tema "dark" automaticamente entre 19h e 7h
  FP.checkAutoNight = function () {
    if (!FP.settings.autoNight) return;
    const hour = new Date().getHours();
    const isNight = hour >= 19 || hour < 7;
    if (isNight && FP.settings.theme !== "dark") {
      FP._themeBeforeNight = FP.settings.theme;
      FP.applyTheme("dark");
    } else if (!isNight && document.documentElement.getAttribute("data-theme") === "dark" && FP._themeBeforeNight) {
      FP.applyTheme(FP._themeBeforeNight);
    }
  };

  FP.saveSettings = async function () { await FP.store.setItem("settings", FP.settings); };

  function syncSettingsUI() {
    document.querySelectorAll(".fp-theme-opt").forEach((b) => b.classList.toggle("active", b.dataset.themeOpt === FP.settings.theme));
    document.getElementById("fp-auto-night").checked = !!FP.settings.autoNight;
    document.getElementById("fp-font-size-label").textContent = FP.settings.fontSize + "px";
    renderGlossaryList();
  }

  /* =========================================================
     ANOTAÇÕES / COMENTÁRIOS LOCAIS POR PARÁGRAFO
     ========================================================= */
  FP.extSetupAnnotations = async function () {
    const container = document.getElementById("reader-content");
    if (!container) return;
    const book = FP.currentBook;
    const annotations = book ? ((await FP.store.getItem("annotations_" + book.id)) || {}) : {};
    FP._currentAnnotations = annotations;

    container.querySelectorAll("p").forEach((p, idx) => {
      if (p.dataset.fpBound) return;
      p.dataset.fpBound = "1";
      p.dataset.fpPid = p.dataset.fpPid || ("p" + idx + "_" + FP.hashText(p.textContent));
      p.classList.add("fp-annotatable");

      if (annotations[p.dataset.fpPid]) FP.addNoteIcon(p);

      p.addEventListener("click", (e) => {
        if (window.getSelection().toString().length > 0) return; // evita conflito com seleção de texto
        if (e.target.classList.contains("fp-note-icon")) return;
        FP.openNoteModal(p.dataset.fpPid, p.textContent.slice(0, 80));
      });
    });
  };

  FP.hashText = function (str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; }
    return Math.abs(h);
  };

  FP.addNoteIcon = function (p) {
    if (p.querySelector(".fp-note-icon")) return;
    const icon = document.createElement("span");
    icon.className = "fp-note-icon";
    icon.innerHTML = "💬";
    icon.onclick = (e) => { e.stopPropagation(); FP.openNoteModal(p.dataset.fpPid, p.textContent.slice(0, 80)); };
    p.appendChild(icon);
  };

  FP.openNoteModal = function (pid, preview) {
    FP._activeNotePid = pid;
    const modal = document.getElementById("fp-note-modal");
    const textarea = document.getElementById("fp-note-text");
    const existing = (FP._currentAnnotations || {})[pid];
    textarea.value = existing ? existing.text : "";
    document.getElementById("fp-note-delete-btn").classList.toggle("hidden", !existing);
    modal.classList.remove("hidden");

    document.getElementById("fp-note-save-btn").onclick = async () => {
      const text = textarea.value.trim();
      if (!text) { modal.classList.add("hidden"); return; }
      FP._currentAnnotations[pid] = {
        text, preview, bookId: FP.currentBook.id, bookTitle: FP.currentBook.title, createdAt: Date.now()
      };
      await FP.store.setItem("annotations_" + FP.currentBook.id, FP._currentAnnotations);
      FP.refreshNoteIcons();
      modal.classList.add("hidden");
      FP.toast("Anotação salva!");
    };
    document.getElementById("fp-note-delete-btn").onclick = async () => {
      delete FP._currentAnnotations[pid];
      await FP.store.setItem("annotations_" + FP.currentBook.id, FP._currentAnnotations);
      FP.refreshNoteIcons();
      modal.classList.add("hidden");
    };
  };

  FP.refreshNoteIcons = function () {
    const container = document.getElementById("reader-content");
    container.querySelectorAll("p").forEach((p) => {
      const existing = p.querySelector(".fp-note-icon");
      if (FP._currentAnnotations[p.dataset.fpPid]) { if (!existing) FP.addNoteIcon(p); }
      else if (existing) existing.remove();
    });
  };

  // Aba "Minhas Anotações" no dashboard
  FP.extRenderAllNotes = async function (container) {
    container.innerHTML = `<p class="fp-empty-msg">Carregando anotações...</p>`;
    let allNotes = [];
    for (const b of FP.books) {
      const ann = (await FP.store.getItem("annotations_" + b.id)) || {};
      Object.entries(ann).forEach(([pid, note]) => allNotes.push({ pid, bookId: b.id, ...note }));
    }
    allNotes.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (allNotes.length === 0) {
      container.innerHTML = `<p class="fp-empty-msg">Você ainda não fez nenhuma anotação.</p>`;
      return;
    }
    container.innerHTML = "";
    allNotes.forEach((n) => {
      const card = document.createElement("div");
      card.className = "fp-note-card";
      card.innerHTML = `
        <p class="fp-note-card-book">${FP.escape(n.bookTitle)}</p>
        <p class="fp-note-card-quote">"${FP.escape(n.preview)}..."</p>
        <p class="fp-note-card-text">${FP.escape(n.text)}</p>`;
      card.onclick = () => FP.openReader(n.bookId);
      container.appendChild(card);
    });
  };

  /* =========================================================
     SELEÇÃO INTELIGENTE (Popover Flutuante)
     ========================================================= */
  FP.extBindSelectionPopover = function () {
    const container = document.getElementById("reader-content");
    const pop = document.getElementById("fp-selection-popover");
    if (!container || pop.dataset.bound) return;
    pop.dataset.bound = "1";

    const showPopover = (x, y) => {
      pop.innerHTML = `
        <div class="fp-selection-popover-row">
          <button data-act="highlight" title="Destacar"><i class="fa-solid fa-highlighter"></i></button>
          <button data-act="note" title="Adicionar Nota"><i class="fa-regular fa-comment"></i></button>
          <button data-act="translate" title="Traduzir"><i class="fa-solid fa-language"></i></button>
          <button data-act="dict" title="Dicionário"><i class="fa-solid fa-book"></i></button>
        </div>`;
      pop.style.left = Math.max(4, x - 70) + "px";
      pop.style.top = Math.max(4, y - 48) + "px";
      pop.classList.remove("hidden");

      pop.querySelector('[data-act="highlight"]').onclick = () => { FP.highlightSelection(); pop.classList.add("hidden"); };
      pop.querySelector('[data-act="note"]').onclick = () => {
        const text = window.getSelection().toString();
        pop.classList.add("hidden");
        FP.openNoteModal("sel_" + FP.hashText(text + Date.now()), text.slice(0, 80));
      };
      pop.querySelector('[data-act="translate"]').onclick = () => {
        const text = window.getSelection().toString();
        window.open("https://translate.google.com/?sl=auto&tl=pt&text=" + encodeURIComponent(text), "_blank");
        pop.classList.add("hidden");
      };
      pop.querySelector('[data-act="dict"]').onclick = () => {
        const text = window.getSelection().toString().trim().split(/\s+/)[0] || "";
        window.open("https://www.dicio.com.br/" + encodeURIComponent(text), "_blank");
        pop.classList.add("hidden");
      };
    };

    document.addEventListener("mouseup", (e) => {
      if (document.getElementById("fp-view-reader").classList.contains("hidden")) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.toString().trim().length === 0) { pop.classList.add("hidden"); return; }
      if (!container.contains(sel.anchorNode)) return;
      showPopover(e.pageX, e.pageY);
    });
    document.addEventListener("touchend", () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.toString().trim().length === 0) { pop.classList.add("hidden"); return; }
      if (!container.contains(sel.anchorNode)) return;
      const r = sel.getRangeAt(0).getBoundingClientRect();
      showPopover(r.left + window.scrollX, r.top + window.scrollY);
    });
    document.addEventListener("mousedown", (e) => { if (!pop.contains(e.target)) pop.classList.add("hidden"); });
  };

  FP.highlightSelection = function () {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    try {
      const span = document.createElement("span");
      span.className = "fp-highlight";
      range.surroundContents(span);
      FP.toast("Trecho destacado!");
    } catch (e) {
      const texts = [];
      const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) if (range.intersectsNode(node)) texts.push(node);
      texts.forEach((n) => {
        const s = document.createElement("span");
        s.className = "fp-highlight";
        n.parentNode.insertBefore(s, n);
        s.appendChild(n);
      });
    }
    sel.removeAllRanges();
  };

  /* =========================================================
     GLOSSÁRIO / ANTI-TRADUÇÃO
     ========================================================= */
  FP.applyGlossary = function () {
    const container = document.getElementById("reader-content");
    if (!container || !FP.settings.glossary || !FP.settings.glossary.length) return;
    FP.settings.glossary.forEach((term) => {
      if (!term) return;
      const regex = new RegExp("\\b(" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")\\b", "g");
      container.querySelectorAll("p:not([data-fp-glossary-done])").forEach((p) => {
        p.innerHTML = p.innerHTML.replace(regex, '<span translate="no" class="fp-protected">$1</span>');
      });
    });
    container.querySelectorAll("p").forEach((p) => p.setAttribute("data-fp-glossary-done", "1"));
    container.setAttribute("translate", "yes");
  };

  function renderGlossaryList() {
    const list = document.getElementById("fp-glossary-list");
    if (!list) return;
    list.innerHTML = "";
    (FP.settings.glossary || []).forEach((term, i) => {
      const chip = document.createElement("span");
      chip.className = "fp-glossary-chip";
      chip.innerHTML = `${FP.escape(term)} <i class="fa-solid fa-xmark"></i>`;
      chip.querySelector("i").onclick = async () => {
        FP.settings.glossary.splice(i, 1);
        await FP.saveSettings();
        renderGlossaryList();
      };
      list.appendChild(chip);
    });
  }

  document.addEventListener("fp:bookOpened", () => setTimeout(FP.applyGlossary, 300));
  document.addEventListener("fp:relocated", () => setTimeout(FP.applyGlossary, 300));

  /* =========================================================
     MODO AUDIOBOOK (TTS) — window.speechSynthesis
     ========================================================= */
  const synth = window.speechSynthesis;
  FP.ttsState = { playing: false, paused: false, queue: [], idx: 0, rate: 1 };

  FP.ttsBuildQueue = function () {
    const container = document.getElementById("reader-content");
    FP.ttsState.queue = Array.from(container.querySelectorAll("p")).filter((p) => p.textContent.trim().length > 0);
    FP.ttsState.idx = 0;
  };

  FP.ttsSpeakCurrent = function () {
    const q = FP.ttsState.queue;
    if (FP.ttsState.idx >= q.length) { FP.ttsStop(); return; }
    const p = q[FP.ttsState.idx];
    p.scrollIntoView({ block: "center", behavior: "smooth" });
    p.classList.add("fp-tts-active");
    const utter = new SpeechSynthesisUtterance(p.textContent);
    utter.lang = "pt-BR";
    utter.rate = FP.ttsState.rate;
    utter.onend = () => {
      p.classList.remove("fp-tts-active");
      if (!FP.ttsState.paused && FP.ttsState.playing) { FP.ttsState.idx++; FP.ttsSpeakCurrent(); }
    };
    FP._ttsUtter = utter;
    synth.speak(utter);
  };

  FP.ttsPlay = function () {
    if (synth.paused && FP.ttsState.paused) { synth.resume(); FP.ttsState.paused = false; }
    else {
      if (!FP.ttsState.queue.length) FP.ttsBuildQueue();
      FP.ttsState.playing = true;
      FP.ttsState.paused = false;
      FP.ttsSpeakCurrent();
    }
    document.getElementById("fp-tts-playpause").innerHTML = '<i class="fa-solid fa-pause"></i>';
  };
  FP.ttsPause = function () {
    synth.pause();
    FP.ttsState.paused = true;
    document.getElementById("fp-tts-playpause").innerHTML = '<i class="fa-solid fa-play"></i>';
  };
  FP.ttsStop = function () {
    synth.cancel();
    FP.ttsState.playing = false;
    FP.ttsState.paused = false;
    FP.ttsState.idx = 0;
    document.querySelectorAll("#reader-content .fp-tts-active").forEach((p) => p.classList.remove("fp-tts-active"));
    document.getElementById("fp-tts-playpause").innerHTML = '<i class="fa-solid fa-play"></i>';
    document.getElementById("fp-tts-player").classList.add("hidden");
  };

  document.addEventListener("fp:relocated", () => {
    if (FP.ttsState.playing) { synth.cancel(); FP.ttsBuildQueue(); FP.ttsSpeakCurrent(); }
    else FP.ttsState.queue = [];
  });

  /* =========================================================
     COFRE SECRETO (PIN de 4 dígitos)
     ========================================================= */
  FP.openVaultPinModal = function (mode, onSuccess) {
    const modal = document.getElementById("fp-vault-pin-modal");
    const title = document.getElementById("fp-vault-pin-title");
    const hint = document.getElementById("fp-vault-pin-hint");
    const input = document.getElementById("fp-vault-pin-input");
    input.value = "";

    if (mode === "create") {
      title.textContent = "Criar PIN do Cofre";
      hint.textContent = "Defina um PIN de 4 dígitos para proteger o Cofre Secreto.";
    } else {
      title.textContent = "Cofre Secreto";
      hint.textContent = "Digite o PIN de 4 dígitos para continuar.";
    }
    modal.classList.remove("hidden");
    input.focus();

    document.getElementById("fp-vault-pin-confirm-btn").onclick = async () => {
      const pin = input.value.trim();
      if (!/^\d{4}$/.test(pin)) { FP.toast("O PIN deve ter exatamente 4 dígitos."); return; }

      if (mode === "create") {
        FP.settings.vaultPin = FP.hashText(pin).toString();
        await FP.saveSettings();
        modal.classList.add("hidden");
        FP.toast("PIN criado com sucesso!");
        onSuccess && onSuccess();
      } else {
        if (FP.hashText(pin).toString() === FP.settings.vaultPin) {
          modal.classList.add("hidden");
          onSuccess && onSuccess();
        } else {
          FP.toast("PIN incorreto.");
        }
      }
    };
  };

  FP.openVaultSidebar = function () {
    if (!FP.settings.vaultPin) FP.openVaultPinModal("create", FP.showVaultContents);
    else FP.openVaultPinModal("verify", FP.showVaultContents);
  };

  FP.showVaultContents = function () {
    const grid = document.getElementById("fp-vault-book-grid");
    const empty = document.getElementById("fp-vault-empty-msg");
    const vaultBooks = FP.books.filter((b) => b.inVault);
    grid.innerHTML = "";
    empty.classList.toggle("hidden", vaultBooks.length > 0);
    vaultBooks.forEach((b) => grid.appendChild(FP.renderBookCard(b)));
    document.getElementById("fp-vault-view-modal").classList.remove("hidden");
  };

  FP.toggleVault = async function (id) {
    const b = FP.books.find((x) => x.id === id);
    if (!b) return;
    if (!b.inVault) {
      b.inVault = true;
      await FP.saveBooks();
      document.getElementById("fp-detail-modal").classList.add("hidden");
      FP.toast("Movida para o Cofre Secreto.");
      FP.renderDashboard();
    } else {
      const unlock = () => FP.openVaultPinModal("verify", async () => {
        b.inVault = false;
        await FP.saveBooks();
        FP.openBookDetail(id);
        FP.toast("Removida do Cofre Secreto.");
        FP.renderDashboard();
      });
      if (!FP.settings.vaultPin) FP.openVaultPinModal("create", unlock);
      else unlock();
    }
  };

  /* =========================================================
     COFRE DE BACKUP (Exportar / Importar JSON)
     ========================================================= */
  FP.exportBackup = async function () {
    const books = FP.books;
    const files = {};
    const annotations = {};
    for (const b of books) {
      files["file_" + b.id] = await FP.store.getItem("file_" + b.id);
      annotations["annotations_" + b.id] = await FP.store.getItem("annotations_" + b.id);
    }
    const payload = {
      profile: FP.profile, books, series: FP.series, files, annotations,
      settings: FP.settings, exportedAt: new Date().toISOString(), version: 1
    };
    const serializable = JSON.parse(JSON.stringify(payload, (k, v) => {
      if (v instanceof ArrayBuffer) return { __arraybuffer__: Array.from(new Uint8Array(v)) };
      return v;
    }));
    const blob = new Blob([JSON.stringify(serializable)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fanficplayer_backup_${FP.profile.name}_${Date.now()}.json`;
    a.click();
    FP.toast("Backup exportado!");
  };

  FP.importBackup = async function (file) {
    if (!file) return;
    const text = await file.text();
    const data = JSON.parse(text, (k, v) => (v && v.__arraybuffer__ ? new Uint8Array(v.__arraybuffer__).buffer : v));
    FP.books = data.books || [];
    FP.series = data.series || [];
    await FP.saveBooks();
    await FP.saveSeries();
    for (const key in (data.files || {})) await FP.store.setItem(key, data.files[key]);
    for (const key in (data.annotations || {})) await FP.store.setItem(key, data.annotations[key]);
    if (data.settings) {
      FP.settings = data.settings;
      await FP.saveSettings();
      FP.applyTheme(FP.settings.theme);
      FP.applyFontSize(FP.settings.fontSize);
    }
    document.getElementById("fp-backup-modal").classList.add("hidden");
    FP.toast("Backup importado com sucesso!");
    FP.renderDashboard();
  };

  /* =========================================================
     LIGAÇÕES DE UI (sidebar: skins, zen, cofre, backup, glossário, tts)
     ========================================================= */
  document.addEventListener("DOMContentLoaded", () => {
    // Skins & Configurações
    document.getElementById("fp-sidebar-settings-btn").onclick = () => {
      document.getElementById("fp-settings-modal").classList.remove("hidden");
      syncSettingsUI();
    };
    document.getElementById("fp-theme-btn").onclick = () => {
      document.getElementById("fp-settings-modal").classList.remove("hidden");
      syncSettingsUI();
    };
    document.querySelectorAll(".fp-theme-opt").forEach((b) => b.onclick = () => FP.applyTheme(b.dataset.themeOpt, true));
    document.getElementById("fp-font-inc").onclick = () => FP.applyFontSize(FP.settings.fontSize + 1, true);
    document.getElementById("fp-font-dec").onclick = () => FP.applyFontSize(FP.settings.fontSize - 1, true);
    document.getElementById("fp-auto-night").onchange = (e) => {
      FP.settings.autoNight = e.target.checked;
      FP.saveSettings();
      FP.checkAutoNight();
    };
    setInterval(() => FP.checkAutoNight(), 5 * 60 * 1000); // reavalia a cada 5 min

    // Glossário
    document.getElementById("fp-glossary-add").onclick = async () => {
      const input = document.getElementById("fp-glossary-input");
      const term = input.value.trim();
      if (!term) return;
      FP.settings.glossary = FP.settings.glossary || [];
      FP.settings.glossary.push(term);
      await FP.saveSettings();
      input.value = "";
      renderGlossaryList();
      FP.toast("Termo protegido contra tradução!");
    };

    // Modo Foco (Zen)
    document.getElementById("fp-zen-btn").onclick = () => document.getElementById("fp-app").classList.toggle("zen");

    // TTS
    document.getElementById("fp-tts-btn").onclick = () => {
      const player = document.getElementById("fp-tts-player");
      player.classList.toggle("hidden");
      if (!player.classList.contains("hidden") && !FP.ttsState.queue.length) FP.ttsBuildQueue();
    };
    document.getElementById("fp-tts-playpause").onclick = () => {
      if (FP.ttsState.playing && !FP.ttsState.paused) FP.ttsPause(); else FP.ttsPlay();
    };
    document.getElementById("fp-tts-stop").onclick = () => FP.ttsStop();
    document.getElementById("fp-tts-speed").onchange = (e) => {
      FP.ttsState.rate = parseFloat(e.target.value);
      if (FP.ttsState.playing) { synth.cancel(); FP.ttsSpeakCurrent(); }
    };
    document.getElementById("fp-reader-back-btn").addEventListener("click", () => FP.ttsStop());

    // Cofre Secreto
    document.getElementById("fp-sidebar-vault-btn").onclick = () => {
      document.getElementById("fp-sidebar").classList.remove("open");
      document.getElementById("fp-sidebar-overlay").classList.add("hidden");
      FP.openVaultSidebar();
    };
    document.getElementById("fp-detail-vault-btn").onclick = () => FP.toggleVault(FP._detailBookId);

    // Backup
    document.getElementById("fp-sidebar-backup-btn").onclick = () => {
      document.getElementById("fp-sidebar").classList.remove("open");
      document.getElementById("fp-sidebar-overlay").classList.add("hidden");
      document.getElementById("fp-backup-modal").classList.remove("hidden");
    };
    document.getElementById("fp-export-btn").onclick = () => FP.exportBackup();
    document.getElementById("fp-import-backup-input").onchange = (e) => FP.importBackup(e.target.files[0]);
  });

})();

/* ======= FIM DA PARTE 2/2 — app.js completo ======= */