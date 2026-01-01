// self.addEventListener("push", function (event) {
//   const data = event.data.json();
//   const title = data.title || "New Notification";
//   const options = {
//     body: data.body,
//     icon: "/logo.png",
//   };
//   event.waitUntil(self.registration.showNotification(title, options));
// });

self.addEventListener("push", (event) => {
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.message,
      icon: "/logo.png",
      data: { url: data.url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.notification.data?.url) {
    event.waitUntil(clients.openWindow(event.notification.data.url));
  }
});
