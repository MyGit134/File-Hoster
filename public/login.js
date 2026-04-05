const loginInput = document.getElementById('login-input');
const loginBtn = document.getElementById('login-btn');
const loginError = document.getElementById('login-error');

function setError(message) {
  loginError.textContent = message || '';
}

async function tryLogin() {
  const token = loginInput.value.trim();
  if (!token) {
    setError('Введите пароль.');
    return;
  }

  setError('');
  loginBtn.disabled = true;

  try {
    const response = await fetch('/api/list', {
      headers: { 'x-access-token': token }
    });
    if (!response.ok) {
      throw new Error('Неверный пароль.');
    }

    sessionStorage.setItem('mediaAccessToken', token);
    localStorage.setItem('mediaAccessTokenHint', token);
    window.location.href = '/app.html';
  } catch (err) {
    setError(err.message);
  } finally {
    loginBtn.disabled = false;
  }
}

loginBtn.addEventListener('click', tryLogin);
loginInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    tryLogin();
  }
});

const saved = localStorage.getItem('mediaAccessTokenHint');
if (saved) {
  loginInput.value = saved;
  loginInput.focus();
  loginInput.select();
} else {
  loginInput.focus();
}

const sessionToken = sessionStorage.getItem('mediaAccessToken');
if (sessionToken) {
  window.location.href = '/app.html';
}
