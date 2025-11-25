document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('checkinForm');
    const message = document.getElementById('message');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(form);

        message.textContent = "Submitting...";
        form.querySelector('button').disabled = true;

        try {
            const response = await fetch('/checkin', {
                method: 'POST',
                body: formData
            });
            const result = await response.json();
            if(response.ok){
                message.innerHTML = `✅ Ticket submitted!<br>
                                     Scan this QR code to track your request:<br>
                                     <img src="${result.qr}" alt="QR Code">`;
                form.reset();
            } else {
                message.textContent = result.error || "Error submitting ticket.";
            }
        } catch(err){
            console.error(err);
            message.textContent = "Network error, please try again.";
        } finally {
            form.querySelector('button').disabled = false;
        }
    });
});
