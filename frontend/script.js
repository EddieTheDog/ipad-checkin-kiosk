document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('checkinForm');
    const message = document.getElementById('message');

    // Same-origin URL — relative paths
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());

        message.textContent = "Submitting...";
        form.querySelector('button').disabled = true;

        try {
            const response = await fetch('/checkin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const result = await response.json();

            if (response.ok) {
                message.innerHTML = `✅ Request submitted!<br>
                                     Scan this QR code to see your status:<br>
                                     <img src="${result.qr}" alt="QR Code">`;
                form.reset();
            } else {
                message.textContent = result.error || "Something went wrong.";
            }
        } catch (err) {
            console.error(err);
            message.textContent = "Network error. Please try again.";
        } finally {
            form.querySelector('button').disabled = false;
        }
    });
});
