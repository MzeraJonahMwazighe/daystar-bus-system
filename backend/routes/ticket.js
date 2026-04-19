// Get bookingId from URL
const params = new URLSearchParams(window.location.search);
const bookingId = params.get("bookingId");

if (!bookingId) {
    alert("No booking ID found in URL");
} else {
    fetch("http://localhost:3000/api/ticket/" + bookingId)
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            alert(data.error);
            return;
        }

        // Display ticket info
        document.getElementById("ticketId").textContent = data.booking_id;
        document.getElementById("bus").textContent = data.bus_id;
        document.getElementById("seats").textContent = data.seats;
        document.getElementById("destination").textContent = data.destination;
        document.getElementById("amount").textContent = data.total_amount;
        document.getElementById("status").textContent = data.status;
    })
    .catch(err => {
        console.error(err);
        alert("Failed to load ticket");
    });
}