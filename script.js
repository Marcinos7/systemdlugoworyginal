// Konfiguracja Firebase (uzupełnij swoimi danymi)
const firebaseConfig = {
    apiKey: "AIzaSyCzvmsNg9FmfL1w-BxdwtO0E-qY0J7V3PM",
    authDomain: "systemdlugow.firebaseapp.com",
    projectId: "systemdlugow",
    storageBucket: "systemdlugow.firebasestorage.app",
    messagingSenderId: "1094952385361",
    appId: "1:1094952385361:web:ffb9635d9220b945e33170"
};
// Inicjalizacja Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Referencje do elementów DOM
const createDebtButton = document.getElementById('createDebtButton');
const debtForm = document.getElementById('debtForm');
const cancelDebtButton = document.getElementById('cancelDebtButton');
const saveDebtButton = document.getElementById('saveDebtButton');
const addProductButton = document.getElementById('addProductButton');
const productsContainer = document.getElementById('productsContainer');
const debtTitleInput = document.getElementById('debtTitle');
const debtorSelect = document.getElementById('debtorSelect');
const dueDateInput = document.getElementById('dueDate');
const peopleList = document.getElementById('peopleList');
const activeDebtsList = document.getElementById('activeDebtsList');
const archivedDebtsList = document.getElementById('archivedDebtsList');
const receiptModal = document.getElementById('receiptModal');
const receiptContent = document.getElementById('receiptContent');
const printReceiptButton = document.getElementById('printReceiptButton');
const closeReceiptModalButton = document.getElementById('closeReceiptModalButton');


// ---- Funkcje do zarządzania UI ----

// Pokaż/Ukryj formularz tworzenia długu
createDebtButton.addEventListener('click', () => {
    debtForm.classList.remove('hidden');
    createDebtButton.classList.add('hidden');
    resetDebtForm(); // Zresetuj formularz przy każdym otwarciu
});

cancelDebtButton.addEventListener('click', () => {
    debtForm.classList.add('hidden');
    createDebtButton.classList.remove('hidden');
});

// Dodawanie/usuwanie pól produktów w formularzu
addProductButton.addEventListener('click', () => {
    addProductField();
});

productsContainer.addEventListener('click', (event) => {
    if (event.target.classList.contains('remove-product-btn')) {
        event.target.closest('.product-item').remove();
        // Jeśli usunięto wszystkie pola produktów, dodaj jedno puste, aby zawsze było minimum 1
        if (productsContainer.querySelectorAll('.product-item').length === 0) {
            addProductField();
        }
    }
});

function addProductField(productName = '', productPrice = '') {
    const productItem = document.createElement('div');
    productItem.classList.add('product-item');
    productItem.innerHTML = `
        <input type="text" class="product-name" placeholder="Nazwa produktu" value="${productName}">
        <input type="number" class="product-price" placeholder="Cena" step="0.01" value="${productPrice}">
        <button type="button" class="remove-product-btn">Usuń</button>
    `;
    productsContainer.appendChild(productItem);
}

function resetDebtForm() {
    debtTitleInput.value = '';
    // Odznacza wszystkie opcje w selekcie
    Array.from(debtorSelect.options).forEach(option => {
        option.selected = false;
    });
    dueDateInput.value = '';
    productsContainer.innerHTML = '<h3>Produkty:</h3>'; // Usuń stare produkty
    addProductField(); // Dodaj jedno puste pole produktu
}


// ---- Funkcje do Firebase (do zaimplementowania) ----

// Ładowanie osób z bazy danych
async function loadPeople() {
    peopleList.innerHTML = '';
    debtorSelect.innerHTML = ''; // Wyczyść select przed ponownym załadowaniem
    try {
        const snapshot = await db.collection('people').orderBy('name').get();
        snapshot.forEach(doc => {
            const person = doc.data();
            const li = document.createElement('li');
            li.textContent = person.name;
            peopleList.appendChild(li);

            const option = document.createElement('option');
            option.value = doc.id; // Użyj ID dokumentu jako wartości
            option.textContent = person.name;
            debtorSelect.appendChild(option);
        });
    } catch (error) {
        console.error("Błąd podczas ładowania osób: ", error);
    }
}

// Ładowanie długów
async function loadDebts() {
    activeDebtsList.innerHTML = '';
    archivedDebtsList.innerHTML = '';

    try {
        const snapshot = await db.collection('debts').orderBy('createdAt', 'desc').get();
        snapshot.forEach(doc => {
            const debt = { id: doc.id, ...doc.data() };
            displayDebt(debt);
        });
    } catch (error) {
        console.error("Błąd podczas ładowania długów: ", error);
    }
}

// Wyświetlanie pojedynczego długu
function displayDebt(debt) {
    const debtItem = document.createElement('div');
    debtItem.classList.add('debt-item');
    if (debt.isPaid) {
        debtItem.classList.add('archived');
    }

    // Pobierz nazwy dłużników
    const debtorNamesPromises = debt.debtorIds.map(async id => {
        const personDoc = await db.collection('people').doc(id).get();
        return personDoc.exists ? personDoc.data().name : 'Nieznany';
    });

    Promise.all(debtorNamesPromises).then(names => {
        const totalAmount = debt.products.reduce((sum, p) => sum + parseFloat(p.price), 0).toFixed(2);
        const dueDate = new Date(debt.dueDate).toLocaleDateString();

        debtItem.innerHTML = `
            <div>
                <strong>${debt.title}</strong><br>
                Dłużnik(cy): ${names.join(', ')}<br>
                Suma: ${totalAmount} zł<br>
                Termin spłaty: ${dueDate}
            </div>
        `;

        if (!debt.isPaid) {
            const payButton = document.createElement('button');
            payButton.textContent = 'Dług Opłacony';
            payButton.addEventListener('click', () => markDebtAsPaid(debt.id));
            debtItem.appendChild(payButton);
        }

        const viewReceiptButton = document.createElement('button');
        viewReceiptButton.textContent = 'Podgląd Paragonu';
        viewReceiptButton.addEventListener('click', () => showReceiptModal(debt));
        debtItem.appendChild(viewReceiptButton);

        if (debt.isPaid) {
            archivedDebtsList.appendChild(debtItem);
        } else {
            activeDebtsList.appendChild(debtItem);
        }
    });
}

// Zapisywanie nowego długu
saveDebtButton.addEventListener('click', async () => {
    const title = debtTitleInput.value.trim();
    const selectedDebtorOptions = Array.from(debtorSelect.selectedOptions);
    const debtorIds = selectedDebtorOptions.map(option => option.value);
    const dueDate = dueDateInput.value;
    const products = [];

    document.querySelectorAll('.product-item').forEach(item => {
        const name = item.querySelector('.product-name').value.trim();
        const price = item.querySelector('.product-price').value.trim();
        if (name && price && !isNaN(parseFloat(price))) { // Dodatkowa walidacja ceny
            products.push({ name, price: parseFloat(price) });
        }
    });

    if (!title || debtorIds.length === 0 || !dueDate || products.length === 0) {
        alert('Proszę wypełnić wszystkie pola: tytuł, dłużnik, termin spłaty i przynajmniej jeden produkt z ceną.');
        return;
    }

    try {
        const newDebt = {
            title,
            debtorIds,
            products,
            dueDate,
            isPaid: false,
            createdAt: firebase.firestore.FieldValue.serverTimestamp() // Znacznik czasu utworzenia
        };
        await db.collection('debts').add(newDebt);
        alert('Dług został zapisany!');
        debtForm.classList.add('hidden');
        createDebtButton.classList.remove('hidden');
        loadDebts(); // Odśwież listę długów
    } catch (error) {
        console.error("Błąd podczas zapisywania długu: ", error);
        alert('Wystąpił błąd podczas zapisywania długu.');
    }
});


// Oznaczanie długu jako opłaconego
async function markDebtAsPaid(debtId) {
    if (confirm('Czy na pewno chcesz oznaczyć ten dług jako opłacony?')) {
        try {
            await db.collection('debts').doc(debtId).update({ isPaid: true });
            alert('Dług oznaczony jako opłacony!');
            loadDebts(); // Odśwież listę długów
        } catch (error) {
            console.error("Błąd podczas oznaczania długu jako opłaconego: ", error);
            alert('Wystąpił błąd podczas oznaczania długu jako opłaconego.');
        }
    }
}

// Generowanie treści paragonu i wyświetlanie modalu
async function showReceiptModal(debt) {
    // Pobierz nazwy dłużników
    const debtorNames = await Promise.all(debt.debtorIds.map(async id => {
        const personDoc = await db.collection('people').doc(id).get();
        return personDoc.exists ? personDoc.data().name : 'Nieznany';
    }));

    const totalAmount = debt.products.reduce((sum, p) => sum + parseFloat(p.price), 0).toFixed(2);
    const createdAtDate = debt.createdAt && typeof debt.createdAt.toDate === 'function'
                          ? new Date(debt.createdAt.toDate()).toLocaleString()
                          : 'N/A';
    const dueDate = new Date(debt.dueDate).toLocaleDateString();

    let receiptHtml = `
<pre>
<div class="receipt-header">PARAGON DŁUGU</div>
<div class="receipt-subheader">NR: ${debt.id.substring(0, 8)}</div>
----------------------------------------
Data Wystawienia: ${createdAtDate}

Tytuł: ${debt.title}
Dłużnik(cy): ${debtorNames.join(', ')}

----------------------------------------
PRODUKTY:
`;
    debt.products.forEach(p => {
        // Tekst produktów będzie pogrubiony przez #receiptContent style
        receiptHtml += `${p.name.padEnd(25)} ${p.price.toFixed(2).padStart(8)} zł\n`;
    });

    receiptHtml += `
----------------------------------------
<div class="receipt-total">SUMA CAŁKOWITA:            ${totalAmount.padStart(8)} zł</div>
TERMIN SPŁATY: ${dueDate}
----------------------------------------
Status: ${debt.isPaid ? 'OPŁACONY' : 'NIEOPŁACONY'}
----------------------------------------
        Dziękujemy za Spłatę!
----------------------------------------
</pre>
`;

    receiptContent.innerHTML = receiptHtml;
    receiptModal.classList.remove('hidden'); // POKAŻ MODAL
}

// Funkcje modala paragonu
printReceiptButton.addEventListener('click', () => {
    window.print();
});

closeReceiptModalButton.addEventListener('click', () => {
    receiptModal.classList.add('hidden'); // UKRYJ MODAL
});


// ---- Inicjalizacja ----
document.addEventListener('DOMContentLoaded', () => {
    loadPeople();
    loadDebts();

    // Dodaj domyślne pole produktu (na początku)
    addProductField();
    resetDebtForm(); // Upewnij się, że formularz jest czysty i ukryty na starcie
});