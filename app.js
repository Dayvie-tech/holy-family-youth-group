const prayerHouses = [
  "Holy Family Nguviu",
  "Sacred Heart Kangenge",
  "Our Lady of Assumption Gicherori",
  "St. Charles Kibugu",
  "St. John Chrysostom Kathangariri",
  "Our Lady of Visitation Kianguchu",
  "St. Ruth Kathakwa",
  "St. Joseph Gatunduri"
];

const houseContainer = document.querySelector("#home-prayer-houses");
if (houseContainer) {
  houseContainer.innerHTML = prayerHouses.map((name, index) => `
    <a class="house-card" href="prayer-houses.html">
      <span class="house-number">PRAYER HOUSE ${String(index + 1).padStart(2, "0")}</span>
      <h3>${name}</h3>
      <p>Discover this community →</p>
    </a>
  `).join("");
}

const menuButton = document.querySelector(".menu-toggle");
const navigation = document.querySelector("#primary-nav");
if (menuButton && navigation) {
  menuButton.addEventListener("click", () => {
    const expanded = menuButton.getAttribute("aria-expanded") === "true";
    menuButton.setAttribute("aria-expanded", String(!expanded));
    navigation.classList.toggle("open", !expanded);
  });
}

const year = document.querySelector("#current-year");
if (year) year.textContent = new Date().getFullYear();
