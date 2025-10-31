/* --------------------------------------------------------------
   Skrypt aplikacji – wszystko uruchamiane po DOMContentLoaded
   -------------------------------------------------------------- */
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import { db } from './firebase-init.js';

/* ----------  Pomocnicza funkcja selektora ---------- */
const $ = (sel) => document.querySelector(sel);

/* ----------  Zmienne (zostaną zainicjalizowane po DOMReady) ---------- */
let createBtn, form, cancelBtn, saveBtn, addProdBtn, productsC,
    titleInp, debtorSel, dueDateInp,
    peopleUL, activeDiv, archDiv,
    receiptModal, receiptPre, printBtn, closeBtn,
    paymentModal, paymentCash, paymentTransfer, cancelPaymentBtn,
    paymentConfirmModal, paymentConfirmContent, printConfirmBtn, closeConfirmBtn;

/* ----------  Stan płatności ---------- */
let pendingPaymentDebtId = null;   // ID długu, który chcemy opłacić
let pendingPaymentDebtData = null; // pełne dane długu (do wydruku potwierdzenia)

/* ----------  Funkcje UI ---------- */
const hide = (el) => el && el.classList.add('hidden');
const show = (el) => el && el.classList.remove('hidden');

/* Resetuje formularz tworzenia długu */
function resetForm() {
  form.reset();
  debtorSel.querySelectorAll('option').forEach(o => o.selected = false);
  productsC.innerHTML = '';
  addProductField();               // jedno puste pole produktu
}

/* Dodaje pole produktu */
function addProductField(name = '', price = '') {
  const wrapper = document.createElement('div');
  wrapper.className = 'product-item';
  wrapper.innerHTML = `
    <input type="text"  class="p-name"  placeholder="Nazwa"  value="${name}" required>
    <input type="number" class="p-price" placeholder="Cena" value="${price}" step="0.01" min="0" required>
    <button type="button" class="remove">✕</button>`;
  productsC.appendChild(wrapper);
}

/* --------------------------------------------------------------
   ŁADOWANIE DANYCH Z FIRESTORE
   -------------------------------------------------------------- */
async function loadPeople() {
  peopleUL.innerHTML = '';
  debtorSel.innerHTML = '';

  const snap = await getDocs(query(collection(db, 'people'), orderBy('name')));
  snap.forEach(docu => {
    const { name } = docu.data();

    peopleUL.insertAdjacentHTML('beforeend', `<li>${name}</li>`);
    debtorSel.insertAdjacentHTML(
      'beforeend',
      `<option value="${docu.id}">${name}</option>`
    );
  });
}

/* Ładuje wszystkie długi i wyświetla je */
async function loadDebts() {
  activeDiv.innerHTML = '';
  archDiv.innerHTML = '';

  const snap = await getDocs(query(collection(db, 'debts'), orderBy('createdAt', 'desc')));
  for (const docu of snap.docs) {
    const debt = { id: docu.id, ...docu.data() };
    await renderDebt(debt);
  }
}

/* Renderuje pojedynczy dług (aktywne lub archiwum) */
async function renderDebt(debt) {
  // Pobranie nazw dłużników
  const debtorNames = [];
  for (const pid of debt.debtorIds) {
    const pDoc = await getDoc(doc(db, 'people', pid));
    debtorNames.push(pDoc.exists() ? pDoc.data().name : 'Nieznany');
  }

  const total = debt.products.reduce((s, p) => s + Number(p.price), 0).toFixed(2);
  const due   = new Date(debt.dueDate).toLocaleDateString('pl-PL');

  const box = document.createElement('div');
  box.className = 'debt-item' + (debt.isPaid ? ' archived' : '');

  // Informacja o metodzie płatności (jeśli już opłacono)
  let paymentInfo = '';
  if (debt.isPaid && debt.paymentMethod) {
    const payDate = debt.paymentDate?.toDate?.()
      ? debt.paymentDate.toDate().toLocaleDateString('pl-PL')
      : '—';
    paymentInfo = `<br><small>Opłacono: ${payDate} (${debt.paymentMethod})</small>`;
  }

  box.innerHTML = `
    <div>
      <strong>${debt.title}</strong><br>
      Dłużnik(cy): ${debtorNames.join(', ')}<br>
      Suma: ${total} zł<br>
      Termin spłaty: ${due}
      ${paymentInfo}
    </div>
    <div class="btns"></div>
  `;

  const btns = box.querySelector('.btns');

  // Przycisk „Paragon”
  const viewBtn = document.createElement('button');
  viewBtn.textContent = 'Paragon';
  viewBtn.addEventListener('click', () => openReceipt(debt, debtorNames));
  btns.appendChild(viewBtn);

  // Przycisk „Opłacony” (tylko dla nieopłaconych)
  if (!debt.isPaid) {
    const payBtn = document.createElement('button');
    payBtn.textContent = 'Opłacony';
    payBtn.addEventListener('click', () => initiatePayment(debt.id, debt, debtorNames));
    btns.appendChild(payBtn);
  }

  // Dodaj do odpowiedniej sekcji
  (debt.isPaid ? archDiv : activeDiv).appendChild(box);
}

/* --------------------------------------------------------------
   OBSŁUGA PŁATNOŚCI
   -------------------------------------------------------------- */
function initiatePayment(debtId, debtData, debtorNames) {
  pendingPaymentDebtId   = debtId;
  pendingPaymentDebtData = { ...debtData, debtorNames };
  paymentModal.showModal();
}

/* Zapisuje wybraną metodę płatności i generuje potwierdzenie */
async function processPayment(method) {
  if (!pendingPaymentDebtId) return;

  const now = new Date();

  // Aktualizacja dokumentu w Firestore
  await updateDoc(doc(db, 'debts', pendingPaymentDebtId), {
    isPaid: true,
    paymentMethod: method === 'cash' ? 'Gotówka' : 'Przelew',
    paymentDate: serverTimestamp()
  });

  // Generowanie potwierdzenia
  generatePaymentConfirmation(
    pendingPaymentDebtId,
    pendingPaymentDebtData,
    method,
    now
  );

  paymentModal.close();
  loadDebts(); // odśwież listę
}

/* Tworzy tekst potwierdzenia i otwiera modal */
function generatePaymentConfirmation(id, debt, method, date) {
  const total = debt.products.reduce((s, p) => s + Number(p.price), 0).toFixed(2);
  const methodTxt = method === 'cash' ? 'GOTÓWKA' : 'PRZELEW';

  const txt = `
========================================
        POTWIERDZENIE OPŁATY
========================================

NUMER DŁUGU: ${id.slice(0, 8).toUpperCase()}

DATA OPŁACENIA: ${date.toLocaleDateString('pl-PL')}
GODZINA:        ${date.toLocaleTimeString('pl-PL')}

----------------------------------------
TYTUŁ DŁUGU:    ${debt.title}
DŁUŻNIK(CY):   ${debt.debtorNames.join(', ')}

METODA PŁATNOŚCI: ${methodTxt}
OPŁACONA KWOTA:  ${total} ZŁ

----------------------------------------
STATUS: ✓ OPŁACONY
========================================
   Dziękujemy za dokonanie płatności
========================================`;

  paymentConfirmContent.textContent = txt;
  paymentConfirmModal.showModal();

  // Automatyczny wydruk (po krótkim opóźnieniu, żeby modal zdążył się otworzyć)
  setTimeout(() => window.print(), 500);
}

/* --------------------------------------------------------------
   MODAL – PARAGON DŁUGU
   -------------------------------------------------------------- */
function openReceipt(debt, debtorNames = []) {
  const total   = debt.products.reduce((s, p) => s + Number(p.price), 0).toFixed(2);
  const created = debt.createdAt?.toDate?.() ? debt.createdAt.toDate() : new Date();
  const due     = new Date(debt.dueDate);

  let txt = `
========================================
           PARAGON DŁUGU
        NR: ${debt.id.slice(0,8).toUpperCase()}
========================================

Data wystawienia: ${created.toLocaleDateString('pl-PL')} ${created.toLocaleTimeString('pl-PL')}

Tytuł: ${debt.title}

Dłużnik(cy):
${debtorNames.join(', ')}

----------------------------------------
               PRODUKTY
----------------------------------------
`;

  debt.products.forEach(p => {
    const nameLines = p.name.match(/.{1,20}/g) || [p.name];
    nameLines.forEach((line, i) => {
      if (i === 0) {
        txt += `${line.padEnd(20)} ${Number(p.price).toFixed(2).padStart(8)} zł\n`;
      } else {
        txt += `  ${line}\n`;
      }
    });
    txt += '\n';
  });

  txt += `----------------------------------------
SUMA DO ZAPŁATY: ${total.padStart(10)} zł

Termin spłaty: ${due.toLocaleDateString('pl-PL')}

----------------------------------------
Status: ${debt.isPaid ? '✓ OPŁACONY' : '⚠ NIEOPŁACONY'}

Dług można opłacić w ciągu 14 dni
od wystawienia niniejszego paragonu
długu podanymi metodami płatności:
• PRZELEW
• GOTÓWKA
----------------------------------------
`;

  receiptPre.textContent = txt;
  receiptModal.showModal();
}

/* --------------------------------------------------------------
   INICJALIZACJA – wszystko po załadowaniu DOM
   -------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', async () => {
  /* ---- pobranie elementów ---- */
  createBtn               = $('#createDebtBtn');
  form                    = $('#debtForm');
  cancelBtn               = $('#cancelDebtBtn');
  saveBtn                 = $('#saveDebtBtn');
  addProdBtn              = $('#addProductBtn');
  productsC               = $('#productsContainer');
  titleInp                = $('#debtTitle');
  debtorSel               = $('#debtorSelect');
  dueDateInp              = $('#dueDate');
  peopleUL                = $('#peopleList');
  activeDiv               = $('#activeDebtsList');
  archDiv                 = $('#archivedDebtsList');
  receiptModal            = $('#receiptModal');
  receiptPre              = $('#receiptContent');
  printBtn                = $('#printReceiptBtn');
  closeBtn                = $('#closeModalBtn');

  paymentModal            = $('#paymentModal');
  paymentCash             = $('#paymentCash');
  paymentTransfer         = $('#paymentTransfer');
  cancelPaymentBtn        = $('#cancelPaymentBtn');
  paymentConfirmModal    = $('#paymentConfirmModal');
  paymentConfirmContent   = $('#paymentConfirmContent');
  printConfirmBtn         = $('#printConfirmBtn');
  closeConfirmBtn         = $('#closeConfirmBtn');

  /* ---- obsługa zdarzeń ---- */

  // Dodawanie/usuwanie pól produktów
  productsC.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove')) {
      e.target.parentElement.remove();
      if (!productsC.children.length) addProductField();
    }
  });

  addProdBtn.addEventListener('click', () => addProductField());

  // Formularz nowego długu
  createBtn.addEventListener('click', () => {
    show(form);
    hide(createBtn);
    resetForm();
  });

  cancelBtn.addEventListener('click', () => {
    hide(form);
    show(createBtn);
  });

  // Zapis nowego długu
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const title     = titleInp.value.trim();
    const debtorIds = [...debtorSel.selectedOptions].map(o => o.value);
    const dueDate   = dueDateInp.value;
    const products  = [...productsC.children].map(c => ({
      name:  c.querySelector('.p-name').value.trim(),
      price: Number(c.querySelector('.p-price').value)
    })).filter(p => p.name && !isNaN(p.price));

    if (!title || !debtorIds.length || !dueDate || !products.length) {
      alert('Uzupełnij wszystkie wymagane pola.');
      return;
    }

    await addDoc(collection(db, 'debts'), {
      title,
      debtorIds,
      products,
      dueDate,
      isPaid: false,
      createdAt: serverTimestamp()
    });

    hide(form);
    show(createBtn);
    resetForm();
    loadDebts();
  });

  // Paragon – drukowanie
  printBtn.addEventListener('click', () => window.print());
  closeBtn.addEventListener('click', () => receiptModal.close());

  // Wybór metody płatności
  paymentCash.addEventListener('click', () => processPayment('cash'));
  paymentTransfer.addEventListener('click', () => processPayment('transfer'));
  cancelPaymentBtn.addEventListener('click', () => {
    paymentModal.close();
    pendingPaymentDebtId = null;
    pendingPaymentDebtData = null;
  });

  // Potwierdzenie opłaty – drukowanie
  printConfirmBtn.addEventListener('click', () => window.print());
  closeConfirmBtn.addEventListener('click', () => paymentConfirmModal.close());

  /* ---- wczytanie danych ---- */
  await loadPeople();
  await loadDebts();

  // Na starcie formularz jest ukryty, ale dodajemy jedno puste pole produktu
  addProductField();
});