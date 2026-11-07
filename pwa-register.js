if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" })
      .catch((error) => {
        console.warn("The parish portal could not enable offline support:", error);
      });
  });
}