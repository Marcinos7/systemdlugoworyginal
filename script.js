import {
  addDoc, collection, doc, getDoc, getDocs,
  orderBy, query, serverTimestamp, updateDoc
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import { db } from './firebase-init.js';

/* ----------  ZMIENNE DOM ---------- */
const $ = (sel) => document.querySelector(sel);
const createBtn  = $('#createDebtBtn');
const form       = $('#debtForm');
const cancelBtn  = $('#cancelDebtBtn');
const saveBtn    = $('#saveDebtBtn');
const addProdBtn = $('#addProductBtn');
const productsC  = $('#productsContainer');
const titleInp   = $('#debtTitle');
const debtorSel  = $('#debtorSelect');
const dueDateInp = $('#dueDate');
const peopleUL   = $('#peopleList');
const activeDiv  = $('#activeDebtsList');
const archDiv    = $('#archivedDebtsList');
const modal      = $('#receiptModal');
const receiptPre = $('#receiptContent');
const printBtn   = $('#printReceiptBtn');
const closeBtn   = $('#closeModalBtn');

// Nowe elementy dla płatności
const paymentModal = $('#paymentModal');
const paymentCash = $('#paymentCash');
const paymentTransfer = $('#paymentTransfer');
const cancelPaymentBtn = $('#cancelPaymentBtn');
const paymentConfirmModal = $('#paymentConfirmModal');
const paymentConfirmContent = $('#paymentConfirmContent');
const printConfirmBtn = $('#printConfirmBtn');
const closeConfirmBtn = $('#closeConfirmBtn');

// Przechowujemy ID długu do opłacenia
let pendingPaymentDebtId = null;
let pendingPaymentDebtData = null;

/* ----------  UI helpers ---------- */
const hide = (el) => el.classList.add('hidden');
const show = (el) => el.classList.remove('hidden');

const resetForm = () => {
  form.reset();
  debtorSel.querySelectorAll('option').forEach(o => o.selected = false);
  productsC.innerHTML = '';
  addProductField();
};

const addProductField = (name = '', price = '') => {
  const wrap = document.createElement('div');
  wrap.className = 'product-item';
  wrap.innerHTML = `
    <input type="text"  placeholder="Nazwa" value="${name}"  class="p-name" required>
    <input type="number" placeholder="Cena"  value="${price}" class="p-price" step="0.01" min="0" required>
    <button type="button" class="remove">✕</button>`;
  productsC.append(wrap);
};

productsC.addEventListener('click', (e) => {
  if (e.target.classList.contains('remove')) {
    e.target.parentElement.remove();
    if (!productsC.children.length) addProductField();
  }
});

/* ----------  Ładowanie danych ---------- */
const loadPeople = async () => {
  peopleUL.innerHTML = debtorSel.innerHTML = '';
  const snap = await getDocs(query(collection(db, 'people'), orderBy('name')));
  snap.forEach(docu => {
    const { name } = docu.data();

    peopleUL.insertAdjacentHTML('beforeend', `<li>${name}</li>`);
    debtorSel.insertAdjacentHTML(
      'beforeend',
      `<option value="${docu.id}">${name}</option>`
    );
  });
};

const loadDebts = async () => {
  activeDiv.innerHTML = archDiv.innerHTML = '';
  const snap = await getDocs(query(collection(db, 'debts'), orderBy('createdAt', 'desc')));

  for (const docu of snap.docs) {
    const debt = { id: docu.id, ...docu.data() };
    await renderDebt(debt);
  }
};

const renderDebt = async (debt) => {
  /* pobieramy imiona osób */
  const names = [];
  for (const pid of debt.debtorIds) {
    const p = await getDoc(doc(db, 'people', pid));
    names.push(p.exists() ? p.data().name : 'Nieznany');
  }

  const total = debt.products.reduce((s, p) => s + Number(p.price), 0).toFixed(2);
  const due   = new Date(debt.dueDate).toLocaleDateString('pl-PL');

  const box = document.createElement('div');
  box.className = 'debt-item' + (debt.isPaid ? ' archived' : '');
  
  let statusInfo = '';
  if (debt.isPaid && debt.paymentMethod) {
    const paymentDate = debt.paymentDate?.toDate?.() 
      ? debt.paymentDate.toDate().toLocaleDateString('pl-PL') 
      : 'Nieznana data';
    statusInfo = `<br><small>Opłacono: ${paymentDate} (${debt.paymentMethod})</small>`;
  }
  
  box.innerHTML = `
    <div>
      <strong>${debt.title}</strong><br>
      Dłużnik(cy): ${names.join(', ')}<br>
      Suma: ${total} zł<br>
      Termin spłaty: ${due}
      ${statusInfo}
    </div>
    <div class="btns"></div>`;

  const btns = box.querySelector('.btns');

  const view = document.createElement('button');
  view.textContent = 'Paragon';
  view.onclick = () => openReceipt(debt, names);
  btns.append(view);

  if (!debt.isPaid) {
    const pay = document.createElement('button');
    pay.textContent = 'Opłacony';
    pay.onclick = () => initiatePayment(debt.id, debt, names);
    btns.append(pay);
  }

  (debt.isPaid ? archDiv : activeDiv).append(box);
};

/* ----------  PAYMENT FLOW ---------- */
const initiatePayment = (debtId, debtData, names) => {
  pendingPaymentDebtId = debtId;
  pendingPaymentDebtData = { ...debtData, debtorNames: names };
  paymentModal.showModal();
};

const processPayment = async (paymentMethod) => {
  if (!pendingPaymentDebtId) return;
  
  const paymentDate = new Date();
  
  // Aktualizuj dług w bazie
  await updateDoc(doc(db, 'debts', pendingPaymentDebtId), { 
    isPaid: true,
    paymentMethod: paymentMethod,
    paymentDate: serverTimestamp()
  });
  
  // Generuj i wyświetl potwierdzenie
  generatePaymentConfirmation(
    pendingPaymentDebtId, 
    pendingPaymentDebtData, 
    paymentMethod, 
    paymentDate
  );
  
  paymentModal.close();
  loadDebts();
};

const generatePaymentConfirmation = (debtId, debtData, paymentMethod, paymentDate) => {
  const total = debtData.products.reduce((s, p) => s + Number(p.price), 0).toFixed(2);
  const methodText = paymentMethod === 'cash' ? 'GOTÓWKA' : 'PRZELEW';
  
  let confirmText = `
========================================
        POTWIERDZENIE OPŁATY
========================================

NUMER DŁUGU: ${debtId.slice(0, 8).toUpperCase()}

DATA OPŁACENIA: ${paymentDate.toLocaleDateString('pl-PL')}
GODZINA: ${paymentDate.toLocaleTimeString('pl-PL')}

----------------------------------------
TYTUŁ DŁUGU: ${debtData.title}
DŁUŻNIK(CY): ${debtData.debtorNames.join(', ')}

METODA PŁATNOŚCI: ${methodText}

OPŁACONA KWOTA: ${total} ZŁ

----------------------------------------
STATUS: ✓ OPŁACONY

========================================
      Dziękujemy za dokonanie opłaty
========================================`;

  paymentConfirmContent.textContent = confirmText;
  paymentConfirmModal.showModal();
  
  // Automatyczny wydruk po 500ms
  setTimeout(() => {
    window.print();
  }, 500);
};

// Event listeners dla przycisków płatności
paymentCash.onclick = () => processPayment('cash');
paymentTransfer.onclick = () => processPayment('transfer');
cancelPaymentBtn.onclick = () => {
  paymentModal.close();
  pendingPaymentDebtId = null;
  pendingPaymentDebtData = null;
};

printConfirmBtn.onclick = () => window.print();
closeConfirmBtn.onclick = () => paymentConfirmModal.close();

/* ----------  CRUD ---------- */
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const title    = titleInp.value.trim();
  const debtorIds= [...debtorSel.selectedOptions].map(o => o.value);
  const dueDate  = dueDateInp.value;
  const products = [...productsC.children].map(c => ({
    name:  c.querySelector('.p-name').value.trim(),
    price: Number(c.querySelector('.p-price').value)
  })).filter(p => p.name && !isNaN(p.price));

  if (!title || !debtorIds.length || !dueDate || !products.length) {
    alert('Uzupełnij wszystkie wymagane pola.');
    return;
  }

  await addDoc(collection(db, 'debts'), {
    title, debtorIds, products, dueDate,
    isPaid: false,
    createdAt: serverTimestamp()
  });

  hide(form); show(createBtn);
  resetForm();
  loadDebts();
});

/* ----------  Modal Paragonu ---------- */
const openReceipt = (debt, names=[]) => {
  const total = debt.products.reduce((s, p) => s + Number(p.price), 0).toFixed(2);
  const issued = debt.createdAt?.toDate?.() ? debt.createdAt.toDate() : new Date();
  const due    = new Date(debt.dueDate);

  let txt = `
========================================
           PARAGON DŁUGU
        NR: ${debt.id.slice(0,8).toUpperCase()}
========================================

Data wystawienia: 
${issued.toLocaleDateString('pl-PL')} ${issued.toLocaleTimeString('pl-PL')}

Tytuł: ${debt.title}

Dłużnik(cy): 
${names.join(', ')}

========================================
              PRODUKTY
========================================
`;
  
  debt.products.forEach(p => {
    const nameLines = p.name.match(/.{1,20}/g) || [p.name];
    nameLines.forEach((line, idx) => {
      if (idx === 0) {
        txt += `${line.padEnd(20)} ${p.price.toFixed(2).padStart(10)} zł\n`;
      } else {
        txt += `  ${line}\n`;
      }
    });
    txt += '\n';
  });

  txt += `========================================

SUMA DO ZAPŁATY:     ${total.padStart(10)} zł

Termin spłaty: ${due.toLocaleDateString('pl-PL')}

========================================
Status: ${debt.isPaid ? '✓ OPŁACONY' : '⚠ NIEOPŁACONY'}
========================================

Dług można opłacić w ciągu 14 dni
od wystawienia niniejszego paragonu
długu podanymi metodami płatności:
• PRZELEW
• GOTÓWKA

========================================`;

  receiptPre.textContent = txt;
  modal.showModal();
};

printBtn.onclick = () => window.print();
closeBtn.onclick = () => modal.close();

/* ----------  Przyciski formularza ---------- */
createBtn.onclick = () => { show(form); hide(createBtn); resetForm(); };
cancelBtn.onclick = () => { hide(form); show(createBtn); };

/* ----------  Init ---------- */
addProdBtn.onclick = () => addProductField();

document.addEventListener('DOMContentLoaded', async () => {
  resetForm();
  await loadPeople();
  await loadDebts();
});