addEventListener("fetch", async (event) => {
  event.respondWith(new Response("World!"));
});
