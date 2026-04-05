/**
 * 分享海报：导出图 = 白卡单层圆角；全宽头图 + 下方单列备菜/做菜步骤（Apricot 列表式）
 * 逻辑宽 343（375−32），圆角 26
 */
function renderRecipeSharePoster(pageComponent, opts) {
  const recipeName = String(opts.recipeName || "菜谱");
  const prepareSteps = Array.isArray(opts.prepareSteps) ? opts.prepareSteps : [];
  const cookingSteps = Array.isArray(opts.cookingSteps) ? opts.cookingSteps : [];
  const coverLocalPath = opts.coverLocalPath || "";
  const qrLocalPath = opts.qrLocalPath || "";

  const C = {
    onSurface: "#432900",
    onSurfaceVariant: "#765524",
    cream: "#ffe8d2",
    white: "#ffffff",
    stepNumBg: "#f9e534",
    stepNumFg: "#5b5300",
    stepRowLine: "rgba(135, 78, 0, 0.12)",
    qrBorder: "rgba(135, 78, 0, 0.15)",
  };

  const W = 375 - 32;
  const cardR = 26;
  const inner = 18;
  const heroH = Math.round((W * 9) / 16);
  const heroBottomPad = 20;
  /** 菜名相对原位置再下移（增大 y） */
  const heroTitleNudgeY = 30;
  const fontStack = 'system-ui, -apple-system, "PingFang SC", "Helvetica Neue", sans-serif';

  const ptContent = 10;
  const ptFirstSection = 6;
  const sectionHeaderH = 18;
  /** 区块标题「备菜·N 步」与下方步骤列表的间距 */
  const ptStepsAfterHeader = 10;
  const sectionTitleOffsetX = 4 + 12;
  const stepPadTop = 5;
  const stepPadBottom = 7;
  const stepPadX = 0;
  const stepInnerGap = 8;
  const numD = 20;
  const numCornerR = 5;
  const ptNextSection = 12;
  const footerMt = 8;
  const footerPt = 16;
  const footerRowMinH = 102;
  const pbContent = 16;
  const qrWrap = 90;
  const qrPad = 6;
  const qrImg = 78;

  const stepBoxW = W - inner * 2;
  const textMaxW = stepBoxW - numD - stepInnerGap;

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

  function roundTopRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
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
            W - inner * 2
          ).slice(0, 2);
          const titleLineH = 28;

          const stepFont = `600 13px ${fontStack}`;
          const stepLineH = 18;
          const stepTextTopPad = 1;
          const maxLinesPerStep = 4;
          const maxStepsShown = 3;

          const buildStepBlocks = (arr) => {
            const blocks = [];
            const total = arr.length;
            arr.slice(0, maxStepsShown).forEach((st, idx) => {
              const raw = String(st || "").trim();
              const wrapped = measureWrap(raw, stepFont, textMaxW);
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
              blocks.push({ type: "muted", text: "…" });
            }
            return blocks;
          };

          const sections = [];
          if (prepareSteps.length) {
            sections.push({
              label: "备菜",
              n: prepareSteps.length,
              steps: buildStepBlocks(prepareSteps),
            });
          }
          if (cookingSteps.length) {
            sections.push({
              label: "做菜",
              n: cookingSteps.length,
              steps: buildStepBlocks(cookingSteps),
            });
          }

          function measureBelowHero() {
            let h = ptContent;
            if (sections.length) h += ptFirstSection;
            sections.forEach((sec, si) => {
              if (si > 0) h += ptNextSection;
              h += sectionHeaderH;
              h += ptStepsAfterHeader;
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
            h += footerMt + 1 + footerPt + footerRowMinH + pbContent;
            return h;
          }

          const belowHero = measureBelowHero();
          const H = Math.max(320, Math.min(heroH + belowHero, 4000));
          const cornerR = Math.min(cardR, W / 2 - 1, H / 2 - 1);

          canvas.width = W * dpr;
          canvas.height = H * dpr;
          ctx.scale(dpr, dpr);

          ctx.clearRect(0, 0, W, H);
          ctx.save();
          roundRectPath(ctx, 0, 0, W, H, cornerR);
          ctx.clip();

          ctx.fillStyle = C.white;
          ctx.fillRect(0, 0, W, H);

          const heroTopR = Math.min(cardR, W / 2 - 1, heroH / 2 - 1);

          const drawHero = async () => {
            ctx.save();
            roundTopRectPath(ctx, 0, 0, W, heroH, heroTopR);
            ctx.clip();
            if (coverLocalPath) {
              try {
                const img = canvas.createImage();
                await new Promise((resImg, rejImg) => {
                  img.onload = resImg;
                  img.onerror = rejImg;
                  img.src = coverLocalPath;
                });
                drawImageCover(ctx, img, 0, 0, W, heroH);
              } catch (e) {
                const g0 = ctx.createLinearGradient(0, 0, W, heroH);
                g0.addColorStop(0, C.cream);
                g0.addColorStop(1, "#ffd6a8");
                ctx.fillStyle = g0;
                ctx.fillRect(0, 0, W, heroH);
              }
            } else {
              const g0 = ctx.createLinearGradient(0, 0, W, heroH);
              g0.addColorStop(0, C.cream);
              g0.addColorStop(1, "#ffd6a8");
              ctx.fillStyle = g0;
              ctx.fillRect(0, 0, W, heroH);
            }
            const g = ctx.createLinearGradient(0, heroH * 0.25, 0, heroH);
            g.addColorStop(0, "rgba(0,0,0,0)");
            g.addColorStop(0.45, "rgba(0,0,0,0.1)");
            g.addColorStop(1, "rgba(0,0,0,0.6)");
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, W, heroH);

            const blockBottom = heroH - heroBottomPad;
            let ty =
              blockBottom - titleLines.length * titleLineH - 4 + heroTitleNudgeY;
            ctx.fillStyle = "#ffffff";
            ctx.font = `900 24px ${fontStack}`;
            titleLines.forEach((ln) => {
              ctx.fillText(ln, inner, ty);
              ty += titleLineH;
            });
            ctx.restore();
          };

          await drawHero();

          let y = heroH + ptContent;
          if (sections.length) y += ptFirstSection;

          sections.forEach((sec, si) => {
            if (si > 0) y += ptNextSection;

            ctx.fillStyle = C.stepNumBg;
            roundRectPath(ctx, inner, y + 1, 4, 16, 2);
            ctx.fill();

            ctx.fillStyle = C.onSurface;
            ctx.font = `900 17px ${fontStack}`;
            ctx.textBaseline = "alphabetic";
            ctx.fillText(
              `${sec.label} · ${sec.n} 步`,
              inner + sectionTitleOffsetX,
              y + 14
            );
            y += sectionHeaderH;

            y += ptStepsAfterHeader;

            sec.steps.forEach((b, bi) => {
              if (b.type === "step") {
                const rowTop = y;
                const numLeft = inner + stepPadX;
                const numTop = rowTop + stepPadTop;

                ctx.fillStyle = C.stepNumBg;
                roundRectPath(ctx, numLeft, numTop, numD, numD, numCornerR);
                ctx.fill();
                ctx.fillStyle = C.stepNumFg;
                ctx.font = `900 10px ${fontStack}`;
                const num = String(b.num);
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(num, numLeft + numD / 2, numTop + numD / 2);
                ctx.textAlign = "left";
                ctx.textBaseline = "alphabetic";

                ctx.fillStyle = C.onSurface;
                ctx.font = stepFont;
                let ly = rowTop + stepPadTop + stepTextTopPad + 13;
                b.lines.forEach((ln) => {
                  ctx.fillText(ln, inner + stepPadX + numD + stepInnerGap, ly);
                  ly += stepLineH;
                });

                y += b.boxH;
                const next = sec.steps[bi + 1];
                if (next && next.type === "step") {
                  ctx.strokeStyle = "rgba(135, 78, 0, 0.08)";
                  ctx.lineWidth = 1;
                  ctx.beginPath();
                  ctx.moveTo(inner, y);
                  ctx.lineTo(W - inner, y);
                  ctx.stroke();
                  y += 1;
                }
              } else if (b.type === "muted") {
                ctx.fillStyle = "rgba(118, 85, 36, 0.65)";
                ctx.font = `600 12px ${fontStack}`;
                ctx.fillText(b.text, inner + stepPadX + numD + stepInnerGap, y + 12);
                y += 16;
              }
            });
          });

          y += footerMt;
          const footBorderY = y;
          ctx.strokeStyle = C.stepRowLine;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(inner, footBorderY);
          ctx.lineTo(W - inner, footBorderY);
          ctx.stroke();

          y += 1 + footerPt;
          const rowTop = y;

          ctx.textAlign = "left";
          const qrLeft = W - inner - qrWrap;
          const footerTextMaxW = Math.max(80, qrLeft - inner - 8);
          const subFont = `600 11px ${fontStack}`;
          const subLines = measureWrap(
            "扫码查看完整菜谱并加入我的家庭菜谱",
            subFont,
            footerTextMaxW
          ).slice(0, 2);
          const subLineH = 14;
          const titleBlockH = 12 + subLines.length * subLineH;
          const leftCenterY = rowTop + footerRowMinH / 2;
          let ty = leftCenterY - titleBlockH / 2 + 11;

          ctx.fillStyle = C.onSurfaceVariant;
          ctx.font = `900 11px ${fontStack}`;
          ctx.fillText("饭桶宝 · 家厨小帮手", inner, ty);
          ty += 16;
          ctx.font = subFont;
          ctx.fillStyle = "rgba(118, 85, 36, 0.55)";
          subLines.forEach((ln) => {
            ctx.fillText(ln, inner, ty);
            ty += subLineH;
          });

          const qrTop = rowTop + (footerRowMinH - qrWrap) / 2;

          ctx.save();
          ctx.shadowColor = "rgba(0,0,0,0.06)";
          ctx.shadowBlur = 6;
          ctx.shadowOffsetY = 2;
          ctx.shadowOffsetX = 0;
          roundRectPath(ctx, qrLeft, qrTop, qrWrap, qrWrap, 10);
          ctx.fillStyle = C.white;
          ctx.fill();
          ctx.restore();
          roundRectPath(ctx, qrLeft, qrTop, qrWrap, qrWrap, 10);
          ctx.strokeStyle = C.qrBorder;
          ctx.lineWidth = 1;
          ctx.stroke();

          const imgLeft = qrLeft + qrPad;
          const imgTop = qrTop + qrPad;
          if (qrLocalPath) {
            try {
              const qr = canvas.createImage();
              await new Promise((resQ, rejQ) => {
                qr.onload = resQ;
                qr.onerror = rejQ;
                qr.src = qrLocalPath;
              });
              ctx.drawImage(qr, imgLeft, imgTop, qrImg, qrImg);
            } catch (e) {
              ctx.fillStyle = "rgba(118, 85, 36, 0.45)";
              ctx.font = `600 10px ${fontStack}`;
              ctx.textAlign = "center";
              ctx.fillText("码图加载失败", imgLeft + qrImg / 2, imgTop + qrImg / 2);
              ctx.textAlign = "left";
            }
          } else {
            ctx.fillStyle = "rgba(118, 85, 36, 0.35)";
            ctx.font = `600 9px ${fontStack}`;
            ctx.textAlign = "center";
            ctx.fillText("小程序码", imgLeft + qrImg / 2, imgTop + qrImg / 2 - 4);
            ctx.fillText("78×78", imgLeft + qrImg / 2, imgTop + qrImg / 2 + 8);
            ctx.textAlign = "left";
          }

          ctx.restore();

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
