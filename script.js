import {
  addDoc, collection, doc, getDoc, getDocs,
  orderBy, query, serverTimestamp, updateDoc
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import { db } from './firebase-init.js';

const EMAILJS_CONFIG = {
    SERVICE_ID: 'service_i86iyj3',
    TEMPLATE_NEW_DEBT: 'template_2orr235',
    TEMPLATE_PAID_DEBT: 'template_48jy2ur'
};

const $ = (sel) => document.querySelector(sel);

// Selektory
const personForm = $('#personForm'), 
      togglePersonBtn = $('#togglePersonForm'),
      totalOwedEl = $('#totalOwed'),
      activeCountEl = $('#activeCount'),
      debtForm = $('#debtForm'),
      createDebtBtn = $('#createDebtBtn'),
      productsC = $('#productsContainer'),
      activeDiv = $('#activeDebtsList'),
      archDiv = $('#archivedDebtsList'),
      peopleUL = $('#peopleList'),
      debtorSel = $('#debtorSelect'),
      receiptModal = $('#receiptModal'),
      paymentModal = $('#paymentModal'),
      paymentConfirmModal = $('#paymentConfirmModal');

let pendingPaymentDebtId = null;
let pendingPaymentDebtData = null;

// --- FUNKCJE POMOCNICZE ---
const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');

function addProductField(name = '', price = '') {
  const wrapper = document.createElement('div');
  wrapper.className = 'product-item';
  wrapper.innerHTML = `
    <input type="text" class="p-name" placeholder="Produkt" value="${name}" required>
    <input type="number" class="p-price" placeholder="Cena" value="${price}" step="0.01" required>
    <button type="button" class="btn-secondary remove">✕</button>`;
  productsC.appendChild(wrapper);
}

// --- STATYSTYKI ---
function updateDashboard(debts) {
    let total = 0;
    let activeCount = 0;
    debts.forEach(d => {
        if (!d.isPaid) {
            total += d.products.reduce((s, p) => s + Number(p.price), 0);
            activeCount++;
        }
    });
    totalOwedEl.textContent = `${total.toFixed(2)} zł`;
    activeCountEl.textContent = activeCount;
}

// --- FIREBASE: OSOBY ---
async function loadPeople() {
    peopleUL.innerHTML = '';
    debtorSel.innerHTML = '';
    const snap = await getDocs(query(collection(db, 'people'), orderBy('name')));
    snap.forEach(docu => {
        const data = docu.data();
        peopleUL.insertAdjacentHTML('beforeend', `<li>${data.name}</li>`);
        debtorSel.insertAdjacentHTML('beforeend', `<option value="${docu.id}">${data.name}</option>`);
    });
}

togglePersonBtn.addEventListener('click', () => personForm.classList.toggle('hidden'));

personForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#personName').value;
    const email = $('#personEmail').value;
    await addDoc(collection(db, 'people'), { name, email });
    personForm.reset();
    hide(personForm);
    loadPeople();
});

// --- FIREBASE: DŁUGI ---
async function loadDebts() {
    activeDiv.innerHTML = 'Ładowanie...';
    archDiv.innerHTML = '';
    const snap = await getDocs(query(collection(db, 'debts'), orderBy('createdAt', 'desc')));
    const allDebts = [];
    activeDiv.innerHTML = '';

    for (const docu of snap.docs) {
        const debt = { id: docu.id, ...docu.data() };
        allDebts.push(debt);
        await renderDebt(debt);
    }
    updateDashboard(allDebts);
}

async function renderDebt(debt) {
    const names = [];
    for (const pid of debt.debtorIds) {
        const pDoc = await getDoc(doc(db, 'people', pid));
        names.push(pDoc.exists() ? pDoc.data().name : 'Nieznany');
    }

    const total = debt.products.reduce((s, p) => s + Number(p.price), 0).toFixed(2);
    const box = document.createElement('div');
    box.className = `debt-item ${debt.isPaid ? 'archived' : ''}`;
    box.innerHTML = `
        <div>
            <strong>${debt.title}</strong><br>
            <small>${names.join(', ')}</small><br>
            <h3>${total} zł</h3>
            <small>Termin: ${new Date(debt.dueDate).toLocaleDateString('pl-PL')}</small>
        </div>
        <div style="margin-top:15px; display:flex; gap:5px;">
            <button class="btn-small btn-outline view-receipt">Paragon</button>
            ${!debt.isPaid ? `<button class="btn-small pay-debt">Opłać</button>` : ''}
        </div>
    `;

    box.querySelector('.view-receipt').onclick = () => openReceipt(debt, names);
    if (!debt.isPaid) {
        box.querySelector('.pay-debt').onclick = () => {
            pendingPaymentDebtId = debt.id;
            pendingPaymentDebtData = { ...debt, debtorNames: names };
            paymentModal.showModal();
        };
    }

    (debt.isPaid ? archDiv : activeDiv).appendChild(box);
}

// --- EMAILJS ---
async function sendNotificationEmail(templateId, debtData, method = null, debtId = null) {
    const total = debtData.products.reduce((s, p) => s + Number(p.price), 0).toFixed(2);
    for (const pid of debtData.debtorIds) {
        const pDoc = await getDoc(doc(db, 'people', pid));
        if (pDoc.exists() && pDoc.data().email) {
            await emailjs.send(EMAILJS_CONFIG.SERVICE_ID, templateId, {
                to_email: pDoc.data().email,
                to_name: pDoc.data().name,
                order_id: debtId?.slice(0,8).toUpperCase() || 'N/A',
                name: debtData.title,
                price: total,
                payment_method: method || 'N/A'
            });
        }
    }
}

// --- OBSŁUGA PŁATNOŚCI ---
async function processPayment(method) {
    const now = new Date();
    await updateDoc(doc(db, 'debts', pendingPaymentDebtId), {
        isPaid: true,
        paymentMethod: method === 'cash' ? 'Gotówka' : 'Przelew',
        paymentDate: serverTimestamp()
    });

    await sendNotificationEmail(EMAILJS_CONFIG.TEMPLATE_PAID_DEBT, pendingPaymentDebtData, method, pendingPaymentDebtId);
    
    paymentModal.close();
    loadDebts();
    
    // Potwierdzenie
    $('#paymentConfirmContent').textContent = `POTWIERDZENIE\nKwota: ${pendingPaymentDebtData.products.reduce((s,p)=>s+p.price,0).toFixed(2)} zł\nMetoda: ${method}\nData: ${now.toLocaleString()}`;
    paymentConfirmModal.showModal();
}

// --- PARAGON ---
function openReceipt(debt, names) {
    const total = debt.products.reduce((s, p) => s + Number(p.price), 0).toFixed(2);
    let items = debt.products.map(p => `<tr><td>${p.name}</td><td style="text-align:right">${p.price.toFixed(2)} zł</td></tr>`).join('');
    
    $('#receiptContent').innerHTML = `
        <table class="receipt-table">
            <tr class="header"><td colspan="2"><h3>PARAGON DŁUGU</h3></td></tr>
            <tr><td>ID:</td><td style="text-align:right">${debt.id.slice(0,8).toUpperCase()}</td></tr>
            <tr><td>TYTUŁ:</td><td style="text-align:right">${debt.title}</td></tr>
            <tr><td>DŁUŻNIK:</td><td style="text-align:right">${names.join(', ')}</td></tr>
            <tr style="border-top:1px solid #000"><td colspan="2">PRODUKTY:</td></tr>
            ${items}
            <tr style="border-top:2px solid #000; font-weight:bold"><td>SUMA:</td><td style="text-align:right">${total} zł</td></tr>
        </table>
    `;
    receiptModal.showModal();
}

// --- EVENTY STARTOWE ---
document.addEventListener('DOMContentLoaded', () => {
    createDebtBtn.onclick = () => { show(debtForm); hide(createDebtBtn); productsC.innerHTML = ''; addProductField(); };
    $('#cancelDebtBtn').onclick = () => { hide(debtForm); show(createDebtBtn); };
    $('#addProductBtn').onclick = () => addProductField();
    $('#closeModalBtn').onclick = () => receiptModal.close();
    $('#printReceiptBtn').onclick = () => window.print();
    $('#paymentCash').onclick = () => processPayment('Gotówka');
    $('#paymentTransfer').onclick = () => processPayment('Przelew');
    $('#cancelPaymentBtn').onclick = () => paymentModal.close();
    $('#closeConfirmBtn').onclick = () => paymentConfirmModal.close();

    debtForm.onsubmit = async (e) => {
        e.preventDefault();
        const debt = {
            title: $('#debtTitle').value,
            debtorIds: [...debtorSel.selectedOptions].map(o => o.value),
            dueDate: $('#dueDate').value,
            products: [...productsC.querySelectorAll('.product-item')].map(item => ({
                name: item.querySelector('.p-name').value,
                price: Number(item.querySelector('.p-price').value)
            })),
            isPaid: false,
            createdAt: serverTimestamp()
        };
        const docRef = await addDoc(collection(db, 'debts'), debt);
        await sendNotificationEmail(EMAILJS_CONFIG.TEMPLATE_NEW_DEBT, debt, null, docRef.id);
        debtForm.reset();
        hide(debtForm);
        show(createDebtBtn);
        loadDebts();
    };

    loadPeople();
    loadDebts();
});