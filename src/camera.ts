// アプリ内カメラ。<input type="file"> だと iPhone で「写真ライブラリ／写真を撮る」の
// メニューが出てしまうので、getUserMedia で背面カメラを直接開く。

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * カメラを開いて1枚撮る。
 * - 撮れたら Blob、閉じたら null
 * - カメラが使えない（未対応・許可されない）ときは "unavailable"
 */
export async function takePhoto(): Promise<Blob | null | "unavailable"> {
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

  video.srcObject = stream;
  view.hidden = false;
  document.body.classList.add("no-scroll");
  try {
    await video.play();
  } catch {
    // 自動再生できなくても playsinline + muted なら表示はされる
  }

  return new Promise((resolve) => {
    const finish = (result: Blob | null) => {
      shutter.removeEventListener("click", onShutter);
      close.removeEventListener("click", onClose);
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      view.hidden = true;
      document.body.classList.remove("no-scroll");
      resolve(result);
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
      c.toBlob((b) => finish(b), "image/jpeg", 0.92);
    };
    const onClose = () => finish(null);
    shutter.addEventListener("click", onShutter);
    close.addEventListener("click", onClose);
  });
}
