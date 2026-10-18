// アプリ内カメラ。<input type="file"> だと iPhone で「写真ライブラリ／写真を撮る」の
// メニューが出てしまうので、getUserMedia で背面カメラを直接開く。

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface Shot {
  /** 画面上部に出す案内（例: 正面、横から） */
  label: string;
  /** 案内のアイコン（SVG の中身） */
  icon: string;
  /** true なら「スキップ」できる */
  optional?: boolean;
}

/**
 * カメラを開いて、shots の順に撮る（カメラは開いたまま続けて撮れる）。
 * - 撮れた分の Blob を返す。スキップした分は null
 * - 最初の1枚の前に閉じたら null
 * - カメラが使えない（未対応・許可されない）ときは "unavailable"
 */
export async function takePhotos(shots: Shot[]): Promise<(Blob | null)[] | null | "unavailable"> {
  if (!navigator.mediaDevices?.getUserMedia) return "unavailable";

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1920 } },
      audio: false,
    });
  } catch {
    return "unavailable";
  }

  const view = $("camera");
  const video = $<HTMLVideoElement>("cameraVideo");
  const shutter = $<HTMLButtonElement>("shutterBtn");
  const close = $<HTMLButtonElement>("cameraClose");
  const skip = $<HTMLButtonElement>("cameraSkip");
  const library = $<HTMLButtonElement>("cameraLibrary");
  const libraryInput = $<HTMLInputElement>("libraryInput");
  const guide = $("cameraGuide");
  const guideIcon = $("cameraGuideIcon");
  const guideLabel = $("cameraGuideLabel");

  video.srcObject = stream;
  view.hidden = false;
  document.body.classList.add("no-scroll");
  try {
    await video.play();
  } catch {
    // 自動再生できなくても playsinline + muted なら表示はされる
  }

  const results: (Blob | null)[] = [];

  const showShot = (i: number) => {
    const s = shots[i];
    guide.hidden = shots.length < 2;
    guideIcon.innerHTML = s.icon;
    guideLabel.textContent = shots.length > 1 ? `${i + 1}/${shots.length}  ${s.label}` : s.label;
    skip.hidden = !s.optional;
    // 2枚目に切り替わったことが分かるように、案内を少し揺らす
    guide.classList.remove("bump");
    void guide.offsetWidth;
    guide.classList.add("bump");
  };

  return new Promise((resolve) => {
    const finish = (result: (Blob | null)[] | null) => {
      shutter.removeEventListener("click", onShutter);
      close.removeEventListener("click", onClose);
      skip.removeEventListener("click", onSkip);
      library.removeEventListener("click", onLibrary);
      libraryInput.removeEventListener("change", onLibraryPicked);
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      view.hidden = true;
      document.body.classList.remove("no-scroll");
      resolve(result);
    };
    const next = (b: Blob | null) => {
      results.push(b);
      if (results.length >= shots.length) finish(results);
      else showShot(results.length);
    };
    const onShutter = () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d")!.drawImage(video, 0, 0, w, h);
      view.classList.add("flash");
      setTimeout(() => view.classList.remove("flash"), 150);
      c.toBlob((b) => next(b), "image/jpeg", 0.92);
    };
    const onSkip = () => next(null);
    // 保存してある写真を、この1枚の代わりに使う（テストや撮り忘れ用）
    const onLibrary = () => libraryInput.click();
    const onLibraryPicked = () => {
      const f = libraryInput.files?.[0];
      libraryInput.value = "";
      if (f) next(f);
    };
    // 1枚目を撮ったあとに閉じたら、撮れた分だけで進める
    const onClose = () => finish(results.length ? [...results, ...shots.slice(results.length).map(() => null)] : null);
    shutter.addEventListener("click", onShutter);
    close.addEventListener("click", onClose);
    skip.addEventListener("click", onSkip);
    library.addEventListener("click", onLibrary);
    libraryInput.addEventListener("change", onLibraryPicked);
    showShot(0);
  });
}

/** 1枚だけ撮る */
export async function takePhoto(): Promise<Blob | null | "unavailable"> {
  const r = await takePhotos([{ label: "", icon: "" }]);
  if (r === "unavailable" || r === null) return r;
  return r[0];
}
