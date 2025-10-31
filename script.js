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

/* ----------  EMAILJS KONFIGURACJA (Z TWOIMI SZLABLONAMI) ---------- */
const EMAILJS_CONFIG = {
    SERVICE_ID: 'service_i86iyj3',              // ← ZMIEŃ na swoje Service ID z EmailJS
    TEMPLATE_NEW_DEBT: 'debt_created_template',     // ← Twój szablon nowego długu
    TEMPLATE_PAID_DEBT: 'debt_paid_template'        // ← Twój szablon opłaconego długu
};

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
let pendingPaymentDebtId = null;
let pendingPaymentDebtData = null;

/* ----------  Funkcje UI ---------- */
const hide = (el) => el && el.classList.add('hidden');
const show = (el) => el && el.classList.remove('hidden');

function resetForm() {
  form.reset();
  debtorSel.querySelectorAll('option').forEach(o => o.selected = false);
  productsC.innerHTML = '';
  addProductField();
}

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
   FUNKCJA WYSYŁANIA EMAILA (EmailJS) - ZAKTUALIZOWANA
   -------------------------------------------------------------- */
async function sendNotificationEmail(templateId, debtData, method = null, debtId = null) {
    const total = debtData.products.reduce((s, p) => s + Number(p.price), 0).toFixed(2);
    const orderId = debtId ? debtId.slice(0, 8).toUpperCase() : 'NOWY_DŁUG';
    
    // Dla nowego długu
    if (templateId === EMAILJS_CONFIG.TEMPLATE_NEW_DEBT) {
        // Wysyłamy email do każdego dłużnika z listą produktów
        for (const pid of debtData.debtorIds) {
            const pDoc = await getDoc(doc(db, 'people', pid));
            if (pDoc.exists() && pDoc.data().email) {
                
                // Przygotuj listę produktów jako HTML
                let productsHtml = '';
                debtData.products.forEach(product => {
                    productsHtml += `
                        <tr style="vertical-align: top;">
                            <td style="padding: 24px 8px 0 8px; width: 100%;">
                                <div>${product.name}</div>
                                <div style="font-size: 14px; color: #888; padding-top: 4px;">ilość: 1</div>
                            </td>
                            <td style="padding: 24px 4px 0 0; white-space: nowrap;">
                                <strong>${Number(product.price).toFixed(2)} zł</strong>
                            </td>
                        </tr>`;
                });

                const emailParams = {
                    to_email: pDoc.data().email,
                    to_name: pDoc.data().name,
                    order_id: orderId,
                    name: debtData.title,
                    units: debtData.products.length,
                    price: total,
                    'cost.tax': '0.00',      // Brak podatku w tym systemie
                    'cost.total': total
                };

                try {
                    await emailjs.send(EMAILJS_CONFIG.SERVICE_ID, templateId, emailParams);
                    console.log(`✅ Email nowy dług wysłany do ${pDoc.data().name}`);
                } catch (error) {
                    console.error(`❌ Błąd wysyłki nowego długu do ${pDoc.data().name}:`, error);
                }
            }
        }
    }
    // Dla opłaconego długu
    else if (templateId === EMAILJS_CONFIG.TEMPLATE_PAID_DEBT) {
        // Wysyłamy email do każdego dłużnika
        for (const pid of debtData.debtorIds) {
            const pDoc = await getDoc(doc(db, 'people', pid));
            if (pDoc.exists() && pDoc.data().email) {
                
                const emailParams = {
                    to_email: pDoc.data().email,
                    to_name: pDoc.data().name,
                    order_id: orderId
                };

                try {
                    await emailjs.send(EMAILJS_CONFIG.SERVICE_ID, templateId, emailParams);
                    console.log(`✅ Email opłacony dług wysłany do ${pDoc.data().name}`);
                } catch (error) {
                    console.error(`❌ Błąd wysyłki opłaconego długu do ${pDoc.data().name}:`, error);
                }
            }
        }
    }
}

/* --------------------------------------------------------------
   ŁADOWANIE DANYCH Z FIRESTORE
   -------------------------------------------------------------- */
async function loadPeople() {
  peopleUL.innerHTML = '';
  debtorSel.innerHTML = '';

  const snap = await getDocs(query(collection(db, 'people'), orderBy('name')));
  snap.forEach(docu => {
    const data = docu.data();
    const name = data.name;
    const email = data.email || 'Brak emaila';

    peopleUL.insertAdjacentHTML('beforeend', `<li>${name} <small>(${email})</small></li>`);
    debtorSel.insertAdjacentHTML(
      'beforeend',
      `<option value="${docu.id}">${name}</option>`
    );
  });
}

async function loadDebts() {
  activeDiv.innerHTML = '';
  archDiv.innerHTML = '';

  const snap = await getDocs(query(collection(db, 'debts'), orderBy('createdAt', 'desc')));
  for (const docu of snap.docs) {
    const debt = { id: docu.id, ...docu.data() };
    await renderDebt(debt);
  }
}

async function renderDebt(debt) {
  const debtorNames = [];
  for (const pid of debt.debtorIds) {
    const pDoc = await getDoc(doc(db, 'people', pid));
    debtorNames.push(pDoc.exists() ? pDoc.data().name : 'Nieznany');
  }

  const total = debt.products.reduce((s, p) => s + Number(p.price), 0).toFixed(2);
  const due   = new Date(debt.dueDate).toLocaleDateString('pl-PL');

  const box = document.createElement('div');
  box.className = 'debt-item' + (debt.isPaid ? ' archived' : '');

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

  const viewBtn = document.createElement('button');
  viewBtn.textContent = 'Paragon';
  viewBtn.addEventListener('click', () => openReceipt(debt, debtorNames));
  btns.appendChild(viewBtn);

  if (!debt.isPaid) {
    const payBtn = document.createElement('button');
    payBtn.textContent = 'Opłacony';
    payBtn.addEventListener('click', () => initiatePayment(debt.id, debt, debtorNames));
    btns.appendChild(payBtn);
  }

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

async function processPayment(method) {
  if (!pendingPaymentDebtId) return;

  const now = new Date();

  // 1. Aktualizacja w Firestore
  await updateDoc(doc(db, 'debts', pendingPaymentDebtId), {
    isPaid: true,
    paymentMethod: method === 'cash' ? 'Gotówka' : 'Przelew',
    paymentDate: serverTimestamp()
  });

  // 2. Wysyłka emaila o opłaceniu
  await sendNotificationEmail(
    EMAILJS_CONFIG.TEMPLATE_PAID_DEBT,
    pendingPaymentDebtData,
    method === 'cash' ? 'Gotówka' : 'Przelew',
    pendingPaymentDebtId
  );

  // 3. Generowanie potwierdzenia
  generatePaymentConfirmation(
    pendingPaymentDebtId,
    pendingPaymentDebtData,
    method,
    now
  );

  paymentModal.close();
  loadDebts();
}

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
  paymentConfirmModal     = $('#paymentConfirmModal');
  paymentConfirmContent   = $('#paymentConfirmContent');
  printConfirmBtn         = $('#printConfirmBtn');
  closeConfirmBtn         = $('#closeConfirmBtn');

  productsC.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove')) {
      e.target.parentElement.remove();
      if (!productsC.children.length) addProductField();
    }
  });

  addProdBtn.addEventListener('click', () => addProductField());

  createBtn.addEventListener('click', () => {
    show(form);
    hide(createBtn);
    resetForm();
  });

  cancelBtn.addEventListener('click', () => {
    hide(form);
    show(createBtn);
  });

  // Zapis nowego długu + wysyłka emaila
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

    const newDebt = {
      title,
      debtorIds,
      products,
      dueDate,
      isPaid: false
    };

    // Zapis do Firestore
    const docRef = await addDoc(collection(db, 'debts'), {
      ...newDebt,
      createdAt: serverTimestamp()
    });

    // Wysyłka emaila o nowym długu (z ID dokumentu)
    await sendNotificationEmail(
      EMAILJS_CONFIG.TEMPLATE_NEW_DEBT,
      newDebt,
      null,
      docRef.id
    );

    hide(form);
    show(createBtn);
    resetForm();
    loadDebts();
  });

  printBtn.addEventListener('click', () => window.print());
  closeBtn.addEventListener('click', () => receiptModal.close());

  paymentCash.addEventListener('click', () => processPayment('cash'));
  paymentTransfer.addEventListener('click', () => processPayment('transfer'));
  cancelPaymentBtn.addEventListener('click', () => {
    paymentModal.close();
    pendingPaymentDebtId = null;
    pendingPaymentDebtData = null;
  });

  printConfirmBtn.addEventListener('click', () => window.print());
  closeConfirmBtn.addEventListener('click', () => paymentConfirmModal.close());

  await loadPeople();
  await loadDebts();
  addProductField();
});