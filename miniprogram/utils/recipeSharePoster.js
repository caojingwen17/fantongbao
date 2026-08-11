/**
 * 分享海报：暖杏渐变底全幅海报
 * 顶部品牌条 → 4:3 圆角封面卡 → 菜名/步数 → 白卡步骤列表 → 底部二维码
 * 逻辑宽 343（375−32）
 */
function renderRecipeSharePoster(pageComponent, opts) {
  const recipeName = String(opts.recipeName || "菜谱");
  const prepareSteps = Array.isArray(opts.prepareSteps) ? opts.prepareSteps : [];
  const cookingSteps = Array.isArray(opts.cookingSteps) ? opts.cookingSteps : [];
  const coverLocalPath = opts.coverLocalPath || "";
  const qrLocalPath = opts.qrLocalPath || "";

  const C = {
    bg0: "#fff7ee",
    bg1: "#ffe3c2",
    blob: "rgba(255, 182, 92, 0.22)",
    white: "#ffffff",
    onSurface: "#432900",
    onSurfaceVariant: "#765524",
    primary: "#874e00",
    accent: "#ff9800",
    accentSoft: "rgba(255, 152, 0, 0.16)",
    divider: "rgba(135, 78, 0, 0.08)",
    qrBorder: "rgba(135, 78, 0, 0.15)",
    cardShadow: "rgba(135, 78, 0, 0.16)",
  };

  const W = 375 - 32;
  const padX = 16;
  const contentW = W - padX * 2;
  const fontStack = 'system-ui, -apple-system, "PingFang SC", "Helvetica Neue", sans-serif';

  /* 顶部品牌条 */
  const ptContent = 18;
  const headerH = 24;
  const headerMb = 14;

  /* 封面卡（4:3，与上传裁切比例一致） */
  const heroH = Math.round((contentW * 3) / 4);
  const heroR = 18;
  const heroMb = 16;

  /* 菜名 + 步数概览 */
  const titleLineH = 30;
  const titleMb = 8;
  const metaH = 16;
  const metaMb = 16;

  /* 步骤白卡 */
  const cardR = 20;
  const cardPadX = 14;
  const cardPadTop = 16;
  const cardPadBottom = 14;
  const secHeaderH = 20;
  const secHeaderMb = 8;
  const secGap = 16;
  const numD = 20;
  const stepNumGap = 10;
  const stepPadTop = 6;
  const stepPadBottom = 8;
  const stepLineH = 18;
  const stepTextTopPad = 1;

  /* 底部二维码区 */
  const footerMt = 16;
  const footerH = 88;
  const pbContent = 20;
  const qrWrap = 84;
  const qrPad = 6;
  const qrImg = 72;

  const stepTextMaxW = contentW - cardPadX * 2 - numD - stepNumGap;

  function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  function drawImageCover(ctx, img, dx, dy, dw, dh) {
    const iw = img.width;
    const ih = img.height;
    if (!iw || !ih) {
      ctx.drawImage(img, dx, dy, dw, dh);
      return;
    }
    const scale = Math.max(dw / iw, dh / ih);
    const sw = dw / scale;
    const sh = dh / scale;
    const sx = (iw - sw) / 2;
    const sy = (ih - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  function loadImage(canvas, src) {
    return new Promise((resImg, rejImg) => {
      const img = canvas.createImage();
      img.onload = () => resImg(img);
      img.onerror = rejImg;
      img.src = src;
    });
  }

  return new Promise((resolve, reject) => {
    wx.createSelectorQuery()
      .in(pageComponent)
      .select("#sharePosterCanvas")
      .fields({ node: true, size: true })
      .exec(async (res) => {
        try {
          if (!res || !res[0] || !res[0].node) {
            reject(new Error("canvas 未就绪"));
            return;
          }
          const canvas = res[0].node;
          const ctx = canvas.getContext("2d");
          const dpr = wx.getSystemInfoSync().pixelRatio || 2;

          const measureWrap = (text, font, maxW) => {
            ctx.font = font;
            const s = String(text || "");
            const lines = [];
            let line = "";
            for (let i = 0; i < s.length; i++) {
              const ch = s[i];
              const test = line + ch;
              if (ctx.measureText(test).width > maxW && line) {
                lines.push(line);
                line = ch;
              } else {
                line = test;
              }
            }
            if (line) lines.push(line);
            return lines;
          };

          const titleLines = measureWrap(
            recipeName,
            `900 24px ${fontStack}`,
            contentW
          ).slice(0, 2);

          const stepFont = `600 13px ${fontStack}`;
          const maxLinesPerStep = 3;
          const maxStepsShown = 3;

          const buildStepBlocks = (arr) => {
            const blocks = [];
            const total = arr.length;
            arr.slice(0, maxStepsShown).forEach((st, idx) => {
              const raw = String(st || "").trim();
              const wrapped = measureWrap(raw, stepFont, stepTextMaxW);
              const lines = wrapped.slice(0, maxLinesPerStep);
              const textH = stepTextTopPad + lines.length * stepLineH;
              const rowContentH = Math.max(numD, textH);
              const boxH = stepPadTop + rowContentH + stepPadBottom;
              blocks.push({ type: "step", num: idx + 1, lines, boxH });
              if (wrapped.length > maxLinesPerStep) {
                blocks.push({ type: "muted", text: "…" });
              }
            });
            if (total > maxStepsShown) {
              blocks.push({ type: "muted", text: `… 共 ${total} 步` });
            }
            return blocks;
          };

          const sections = [];
          if (prepareSteps.length) {
            sections.push({ label: "备菜", n: prepareSteps.length, steps: buildStepBlocks(prepareSteps) });
          }
          if (cookingSteps.length) {
            sections.push({ label: "做菜", n: cookingSteps.length, steps: buildStepBlocks(cookingSteps) });
          }

          /* 高度测量 */
          const measureStepsCard = () => {
            if (!sections.length) return 0;
            let h = cardPadTop;
            sections.forEach((sec, si) => {
              if (si > 0) h += secGap;
              h += secHeaderH + secHeaderMb;
              sec.steps.forEach((b, bi) => {
                if (b.type === "step") {
                  h += b.boxH;
                  const next = sec.steps[bi + 1];
                  if (next && next.type === "step") h += 1;
                } else {
                  h += 16;
                }
              });
            });
            h += cardPadBottom;
            return h;
          };

          const metaText = sections.length
            ? sections.map((s) => `${s.label} ${s.n} 步`).join(" · ")
            : "家厨好味，与你分享";

          const stepsCardH = measureStepsCard();
          let H = ptContent + headerH + headerMb + heroH + heroMb;
          H += titleLines.length * titleLineH + titleMb + metaH + metaMb;
          if (stepsCardH) H += stepsCardH + footerMt;
          H += footerH + pbContent;
          H = Math.max(360, Math.min(H, 4000));

          canvas.width = W * dpr;
          canvas.height = H * dpr;
          ctx.scale(dpr, dpr);

          /* 背景：暖杏渐变 + 光斑 */
          const bgG = ctx.createLinearGradient(0, 0, 0, H);
          bgG.addColorStop(0, C.bg0);
          bgG.addColorStop(1, C.bg1);
          ctx.fillStyle = bgG;
          ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = C.blob;
          ctx.beginPath();
          ctx.arc(W - 20, 30, 76, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(-24, H - 70, 88, 0, Math.PI * 2);
          ctx.fill();

          let y = ptContent;

          /* 顶部品牌条 */
          let brandTextX = padX;
          try {
            const logo = await loadImage(canvas, "/images/icons/launch-logo.png");
            ctx.save();
            roundRectPath(ctx, padX, y, headerH, headerH, 7);
            ctx.clip();
            ctx.drawImage(logo, padX, y, headerH, headerH);
            ctx.restore();
            brandTextX = padX + headerH + 8;
          } catch (e) {}
          ctx.fillStyle = C.primary;
          ctx.font = `900 15px ${fontStack}`;
          ctx.textBaseline = "middle";
          ctx.fillText("饭桶宝", brandTextX, y + headerH / 2 + 1);
          /* 右侧小胶囊 */
          ctx.font = `600 10px ${fontStack}`;
          const pillText = "家厨 · 菜谱";
          const pillTextW = ctx.measureText(pillText).width;
          const pillW = pillTextW + 20;
          const pillH = 20;
          const pillX = W - padX - pillW;
          const pillY = y + (headerH - pillH) / 2;
          ctx.fillStyle = C.accentSoft;
          roundRectPath(ctx, pillX, pillY, pillW, pillH, pillH / 2);
          ctx.fill();
          ctx.fillStyle = C.primary;
          ctx.fillText(pillText, pillX + 10, pillY + pillH / 2 + 1);
          ctx.textBaseline = "alphabetic";
          y += headerH + headerMb;

          /* 封面卡：白底托 + 投影，内部 4:3 图 */
          const heroX = padX;
          const heroY = y;
          ctx.save();
          ctx.shadowColor = C.cardShadow;
          ctx.shadowBlur = 16;
          ctx.shadowOffsetY = 6;
          ctx.shadowOffsetX = 0;
          ctx.fillStyle = C.white;
          roundRectPath(ctx, heroX, heroY, contentW, heroH, heroR);
          ctx.fill();
          ctx.restore();
          ctx.save();
          roundRectPath(ctx, heroX, heroY, contentW, heroH, heroR);
          ctx.clip();
          let heroDrawn = false;
          if (coverLocalPath) {
            try {
              const img = await loadImage(canvas, coverLocalPath);
              drawImageCover(ctx, img, heroX, heroY, contentW, heroH);
              heroDrawn = true;
            } catch (e) {}
          }
          if (!heroDrawn) {
            const g0 = ctx.createLinearGradient(heroX, heroY, heroX, heroY + heroH);
            g0.addColorStop(0, "#ffe8d2");
            g0.addColorStop(1, "#ffd6a8");
            ctx.fillStyle = g0;
            ctx.fillRect(heroX, heroY, contentW, heroH);
            ctx.fillStyle = "rgba(135, 78, 0, 0.35)";
            ctx.font = `900 15px ${fontStack}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("饭桶宝 · 今日好菜", heroX + contentW / 2, heroY + heroH / 2);
            ctx.textAlign = "left";
            ctx.textBaseline = "alphabetic";
          }
          ctx.restore();
          y += heroH + heroMb;

          /* 菜名 */
          ctx.fillStyle = C.onSurface;
          ctx.font = `900 24px ${fontStack}`;
          titleLines.forEach((ln) => {
            ctx.fillText(ln, padX, y + 22);
            y += titleLineH;
          });
          y += titleMb;

          /* 步数概览 */
          ctx.fillStyle = C.onSurfaceVariant;
          ctx.font = `600 12px ${fontStack}`;
          ctx.fillText(metaText, padX, y + 11);
          y += metaH + metaMb;

          /* 步骤白卡 */
          if (sections.length) {
            const cardX = padX;
            const cardY = y;
            ctx.save();
            ctx.shadowColor = C.cardShadow;
            ctx.shadowBlur = 14;
            ctx.shadowOffsetY = 5;
            ctx.shadowOffsetX = 0;
            ctx.fillStyle = C.white;
            roundRectPath(ctx, cardX, cardY, contentW, stepsCardH, cardR);
            ctx.fill();
            ctx.restore();

            let cy = cardY + cardPadTop;
            const textX = cardX + cardPadX;

            sections.forEach((sec, si) => {
              if (si > 0) cy += secGap;

              /* 区块标题：橙色小方块 + 备菜·N 步 */
              ctx.fillStyle = C.accent;
              roundRectPath(ctx, textX, cy + 2, 5, 16, 2.5);
              ctx.fill();
              ctx.fillStyle = C.onSurface;
              ctx.font = `900 15px ${fontStack}`;
              ctx.fillText(`${sec.label} · ${sec.n} 步`, textX + 12, cy + 15);
              cy += secHeaderH + secHeaderMb;

              sec.steps.forEach((b, bi) => {
                if (b.type === "step") {
                  const rowTop = cy;
                  const numTop = rowTop + stepPadTop;

                  /* 序号圆：浅橙底 + 深棕字（与 App 内步骤序号一致） */
                  ctx.fillStyle = C.accentSoft;
                  ctx.beginPath();
                  ctx.arc(textX + numD / 2, numTop + numD / 2, numD / 2, 0, Math.PI * 2);
                  ctx.fill();
                  ctx.fillStyle = C.primary;
                  ctx.font = `900 10px ${fontStack}`;
                  ctx.textAlign = "center";
                  ctx.textBaseline = "middle";
                  ctx.fillText(String(b.num), textX + numD / 2, numTop + numD / 2 + 0.5);
                  ctx.textAlign = "left";
                  ctx.textBaseline = "alphabetic";

                  ctx.fillStyle = C.onSurface;
                  ctx.font = stepFont;
                  let ly = rowTop + stepPadTop + stepTextTopPad + 13;
                  b.lines.forEach((ln) => {
                    ctx.fillText(ln, textX + numD + stepNumGap, ly);
                    ly += stepLineH;
                  });

                  cy += b.boxH;
                  const next = sec.steps[bi + 1];
                  if (next && next.type === "step") {
                    ctx.strokeStyle = C.divider;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(textX, cy);
                    ctx.lineTo(cardX + contentW - cardPadX, cy);
                    ctx.stroke();
                    cy += 1;
                  }
                } else if (b.type === "muted") {
                  ctx.fillStyle = "rgba(118, 85, 36, 0.6)";
                  ctx.font = `600 11px ${fontStack}`;
                  ctx.fillText(b.text, textX + numD + stepNumGap, cy + 11);
                  cy += 16;
                }
              });
            });

            y += stepsCardH + footerMt;
          }

          /* 底部：左文案 + 右二维码 */
          const rowTop = y;
          const qrLeft = W - padX - qrWrap;
          const footerTextMaxW = Math.max(80, qrLeft - padX - 12);

          const f1 = "扫码查看完整菜谱";
          const f2Lines = measureWrap(
            "加入我的家庭菜谱，一起好好吃饭",
            `600 11px ${fontStack}`,
            footerTextMaxW
          ).slice(0, 2);
          const fBlockH = 16 + 6 + f2Lines.length * 14;
          let fy = rowTop + (footerH - fBlockH) / 2;

          ctx.fillStyle = C.onSurface;
          ctx.font = `900 13px ${fontStack}`;
          ctx.fillText(f1, padX, fy + 12);
          fy += 16 + 6;
          ctx.fillStyle = "rgba(118, 85, 36, 0.6)";
          ctx.font = `600 11px ${fontStack}`;
          f2Lines.forEach((ln) => {
            ctx.fillText(ln, padX, fy + 10);
            fy += 14;
          });

          const qrTop = rowTop + (footerH - qrWrap) / 2;
          ctx.save();
          ctx.shadowColor = C.cardShadow;
          ctx.shadowBlur = 10;
          ctx.shadowOffsetY = 3;
          ctx.shadowOffsetX = 0;
          ctx.fillStyle = C.white;
          roundRectPath(ctx, qrLeft, qrTop, qrWrap, qrWrap, 12);
          ctx.fill();
          ctx.restore();
          roundRectPath(ctx, qrLeft, qrTop, qrWrap, qrWrap, 12);
          ctx.strokeStyle = C.qrBorder;
          ctx.lineWidth = 1;
          ctx.stroke();

          const imgLeft = qrLeft + qrPad;
          const imgTop = qrTop + qrPad;
          let qrDrawn = false;
          if (qrLocalPath) {
            try {
              const qr = await loadImage(canvas, qrLocalPath);
              ctx.drawImage(qr, imgLeft, imgTop, qrImg, qrImg);
              qrDrawn = true;
            } catch (e) {}
          }
          if (!qrDrawn) {
            ctx.fillStyle = "rgba(118, 85, 36, 0.4)";
            ctx.font = `600 10px ${fontStack}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("小程序码", imgLeft + qrImg / 2, imgTop + qrImg / 2);
            ctx.textAlign = "left";
            ctx.textBaseline = "alphabetic";
          }

          wx.canvasToTempFilePath(
            {
              canvas,
              width: W,
              height: H,
              destWidth: W * dpr,
              destHeight: H * dpr,
              fileType: "png",
              quality: 1,
              success: (r) => resolve(r.tempFilePath),
              fail: reject,
            },
            pageComponent
          );
        } catch (err) {
          reject(err);
        }
      });
  });
}

module.exports = {
  renderRecipeSharePoster,
};
