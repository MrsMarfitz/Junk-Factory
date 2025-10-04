const SECRETUSERNAME = "admin";
const SECRETPASSWORD ="admin123";

let appState = {
  seller: {
    companyName: "",
    address: "",
    npwp: "",
    phone: "",
    email: "",
    logoBase64: null,
  },
  customer: {
    companyName: "",
    contactPerson: "",
    address: "",
    email: "",
    phone: "",
  },
  invoiceMeta: {
    invoiceNumber: "",
    invoiceDate: "",
    dueDate: "",
    paymentTerms: "",
  },
  items: [],
  settings: {
    enablePPN: false,
    ppnRate: 11,
    globalDiscount: 0,
    globalDiscountType: "nominal", 
    shippingCost: 0,
  },
  notes: "",
};

// Utility Functions
/**
 * Format number to Indonesian Rupiah format
 * @param {number} amount - The amount to format
 * @returns {string} Formatted currency string
 */
function formatRupiah(amount) {
  if (isNaN(amount) || amount === null || amount === undefined) {
    return "Rp 0";
  }

  // Apply banker's rounding to 2 decimal places
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;

  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(rounded);
}

/**
 * Parse Rupiah formatted string back to number
 * @param {string} rupiahString - The formatted currency string
 * @returns {number} Parsed number
 */
function parseRupiah(rupiahString) {
  if (!rupiahString || typeof rupiahString !== "string") {
    return 0;
  }

  // Remove currency symbol, spaces, and dots (thousand separators)
  const cleanString = rupiahString
    .replace(/Rp\s?/g, "")
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .trim();

  const parsed = parseFloat(cleanString);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Banker's rounding implementation
 * @param {number} num - Number to round
 * @param {number} decimalPlaces - Number of decimal places
 * @returns {number} Rounded number
 */
function bankersRounding(num, decimalPlaces = 2) {
  const factor = Math.pow(10, decimalPlaces);
  return Math.round((num + Number.EPSILON) * factor) / factor;
}

/**
 * Generate invoice number with format INVC-YYYYMMDD-XXX
 * @returns {string} Generated invoice number
 */
function generateInvoiceNumber() {
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0].replace(/-/g, "");
  const storageKey = `invoice_sequence_${dateStr}`;

  // Get current sequence for today
  let sequence = parseInt(localStorage.getItem(storageKey) || "0", 10);
  sequence += 1;

  // Store updated sequence
  localStorage.setItem(storageKey, sequence.toString());

  // Clean up old sequences (older than 30 days)
  cleanupOldSequences();

  // Format sequence to 3 digits
  const sequenceStr = sequence.toString().padStart(3, "0");

  return `INVC-${dateStr}-${sequenceStr}`;
}

/**
 * Clean up old invoice sequences from localStorage
 */
function cleanupOldSequences() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoffDate = thirtyDaysAgo
    .toISOString()
    .split("T")[0]
    .replace(/-/g, "");

  Object.keys(localStorage).forEach((key) => {
    if (key.startsWith("invoice_sequence_")) {
      const dateStr = key.replace("invoice_sequence_", "");
      if (dateStr < cutoffDate) {
        localStorage.removeItem(key);
      }
    }
  });
}

// Calculation Functions
/**
 * Calculate item total
 * @param {Object} item - Item object with quantity, unitPrice, itemTax, itemDiscount
 * @returns {number} Item total
 */
function calculateItemTotal(item) {
  const qty = parseFloat(item.quantity) || 0;
  const price = parseFloat(item.unitPrice) || 0;
  const taxRate = parseFloat(item.itemTax) || 0;
  const discount = parseFloat(item.itemDiscount) || 0;

  const subtotal = qty * price;
  const tax = (subtotal * taxRate) / 100;
  const total = subtotal + tax - discount;

  return Math.max(0, bankersRounding(total));
}

/**
 * Calculate invoice subtotal
 * @returns {number} Subtotal of all items
 */
function calculateSubtotal() {
  return appState.items.reduce((sum, item) => {
    return sum + calculateItemTotal(item);
  }, 0);
}

/**
 * Calculate PPN amount
 * @param {number} subtotal - Subtotal amount
 * @returns {number} PPN amount
 */
function calculatePPN(subtotal) {
  if (!appState.settings.enablePPN) return 0;
  return bankersRounding((subtotal * appState.settings.ppnRate) / 100);
}

/**
 * Calculate final total
 * @returns {number} Final total amount
 */
function calculateTotal() {
  const subtotal = calculateSubtotal();
  const discountValue = parseFloat(appState.settings.globalDiscount) || 0;
  const discountType = appState.settings.globalDiscountType || 'nominal';
  let discountAmount = 0;

  if (discountType === 'percent') {
    discountAmount = (discountValue / 100) * subtotal;
  } else {
    discountAmount = discountValue;
  }
  discountAmount = Math.min(discountAmount, subtotal);

  const ppn = calculatePPN(subtotal - discountAmount);
  const shipping = parseFloat(appState.settings.shippingCost) || 0;

  return bankersRounding(subtotal - discountAmount + ppn + shipping, 2);
}


// Item Management Functions
/**
 * Add new item to the invoice
 */
function addItem() {
  const newItem = {
    id: Date.now(), // Simple ID generation
    description: "",
    quantity: 1,
    unitPrice: 0,
    itemTax: 0,
    itemDiscount: 0,
  };

  appState.items.push(newItem);
  renderItemsTable();
  updateSummary();
  updateInvoicePreview();
}

/**
 * Remove item from the invoice
 * @param {number} itemId - ID of item to remove
 */
function removeItem(itemId) {
  appState.items = appState.items.filter((item) => item.id !== itemId);
  renderItemsTable();
  updateSummary();
  updateInvoicePreview();
}

/**
 * Update item in the state
 * @param {number} itemId - ID of item to update
 * @param {string} field - Field name to update
 * @param {any} value - New value
 */
function updateItem(itemId, field, value) {
  const item = appState.items.find((item) => item.id === itemId);
  if (item) {
    if (field === "unitPrice" || field === "itemDiscount") {
      item[field] = parseFloat(value) || 0;
    } else {
      item[field] = value;
    }
    renderItemsTable();
    updateSummary();
    updateInvoicePreview();
  }
}

/**
 * Render items table
 */
function renderItemsTable() {
  const tbody = document.getElementById("itemsTableBody");
  tbody.innerHTML = "";

  appState.items.forEach((item) => {
    const row = document.createElement("tr");
    const itemTotal = calculateItemTotal(item);

    row.innerHTML = `
            <td>
                <input type="text" value="${item.description || ""}" 
                       onchange="updateItem(${
                         item.id
                       }, 'description', this.value)"
                       placeholder="Deskripsi item">
            </td>
            <td>
                <input type="number" value="${
                  item.quantity || 1
                }" min="0" step="1"
                       onchange="updateItem(${item.id}, 'quantity', this.value)"
                       class="text-center">
            </td>
            <td>
                <input type="number" value="${
                  item.unitPrice || 0
                }" min="0" step="1000"
                       onchange="updateItem(${
                         item.id
                       }, 'unitPrice', this.value)"
                       placeholder="0">
            </td>
            <td>
                <input type="number" value="${
                  item.itemTax || 0
                }" min="0" max="100" step="0.1"
                       onchange="updateItem(${item.id}, 'itemTax', this.value)"
                       class="text-center" placeholder="0">
            </td>
            <td>
                <input type="number" value="${
                  item.itemDiscount || 0
                }" min="0" step="1000"
                       onchange="updateItem(${
                         item.id
                       }, 'itemDiscount', this.value)"
                       placeholder="0">
            </td>
            <td class="text-right">
                <strong>${formatRupiah(itemTotal)}</strong>
            </td>
            <td>
                <button type="button" class="remove-btn" onclick="removeItem(${
                  item.id
                })">
                    Hapus
                </button>
            </td>
        `;
    tbody.appendChild(row);
  });
}

/**
 * Update summary calculations display
 */
function updateSummary() {
  const subtotal = calculateSubtotal();
  const discountValue = parseFloat(appState.settings.globalDiscount) || 0;
  const discountType = appState.settings.globalDiscountType || 'nominal';
  let discountAmount = 0;

  if (discountType === 'percent') {
    discountAmount = (discountValue / 100) * subtotal;
  } else {
    discountAmount = discountValue;
  }
  discountAmount = Math.min(discountAmount, subtotal);

  const ppn = calculatePPN(subtotal - discountAmount);
  const shipping = parseFloat(appState.settings.shippingCost) || 0;
  const total = calculateTotal();

  document.getElementById('subtotalAmount').textContent = formatRupiah(subtotal);
  document.getElementById('globalDiscountAmount').textContent =
    discountType === 'percent' ? `${discountValue.toFixed(2)} %` : formatRupiah(discountValue);
  document.getElementById('ppnAmount').textContent = formatRupiah(ppn);
  document.getElementById('shippingAmount').textContent = formatRupiah(shipping);
  document.getElementById('totalAmount').textContent = formatRupiah(total);
}


// Invoice Template Functions
/**
 * Generate invoice template HTML
 * @returns {string} Invoice HTML template
 */
function generateInvoiceTemplate() {
  const subtotal = calculateSubtotal();
  const globalDiscount = appState.settings.globalDiscount || 0;
  const ppn = calculatePPN(subtotal - globalDiscount);
  const shipping = appState.settings.shippingCost || 0;
  const total = calculateTotal();
  const logoContent = appState.seller.logoBase64
    ? `<img src="${appState.seller.logoBase64}" alt="Company Logo">`
    : "LOGO";

  return `
        <div class="invoice-template">
            <div class="invoice-header">
                <div class="invoice-logo-section">
                    <div class="invoice-logo">${logoContent}</div>
                    <div class="company-info">
                        <h1>${
                          appState.seller.companyName || "Nama Perusahaan"
                        }</h1>
                        <p>${appState.seller.address || "Alamat Perusahaan"}</p>
                        ${
                          appState.seller.phone
                            ? `<p>Tel: ${appState.seller.phone}</p>`
                            : ""
                        }
                        ${
                          appState.seller.email
                            ? `<p>Email: ${appState.seller.email}</p>`
                            : ""
                        }
                        ${
                          appState.seller.npwp
                            ? `<p>NPWP: ${appState.seller.npwp}</p>`
                            : ""
                        }
                    </div>
                </div>
                <div class="invoice-title-section">
                    <div class="invoice-title">INVOICE</div>
                    <div class="invoice-meta">
                        <p><strong>No. Invoice:</strong> ${
                          appState.invoiceMeta.invoiceNumber
                        }</p>
                        <p><strong>Tanggal:</strong> ${formatDate(
                          appState.invoiceMeta.invoiceDate
                        )}</p>
                        ${
                          appState.invoiceMeta.dueDate
                            ? `<p><strong>Jatuh Tempo:</strong> ${formatDate(
                                appState.invoiceMeta.dueDate
                              )}</p>`
                            : ""
                        }
                        ${
                          appState.invoiceMeta.paymentTerms
                            ? `<p><strong>Termin:</strong> ${appState.invoiceMeta.paymentTerms}</p>`
                            : ""
                        }
                    </div>
                </div>
            </div>

            <div class="invoice-parties">
                <div class="party-section">
                    <h3>Dari:</h3>
                    <p><strong>${
                      appState.seller.companyName || "Nama Perusahaan"
                    }</strong></p>
                    <p>${appState.seller.address || "Alamat Perusahaan"}</p>
                    ${
                      appState.seller.phone
                        ? `<p>Tel: ${appState.seller.phone}</p>`
                        : ""
                    }
                    ${
                      appState.seller.email
                        ? `<p>Email: ${appState.seller.email}</p>`
                        : ""
                    }
                    ${
                      appState.seller.npwp
                        ? `<p>NPWP: ${appState.seller.npwp}</p>`
                        : ""
                    }
                </div>
                <div class="party-section">
                    <h3>Kepada:</h3>
                    <p><strong>${
                      appState.customer.companyName || "Nama Pelanggan"
                    }</strong></p>
                    ${
                      appState.customer.contactPerson
                        ? `<p>Attn: ${appState.customer.contactPerson}</p>`
                        : ""
                    }
                    <p>${appState.customer.address || "Alamat Pelanggan"}</p>
                    ${
                      appState.customer.phone
                        ? `<p>Tel: ${appState.customer.phone}</p>`
                        : ""
                    }
                    ${
                      appState.customer.email
                        ? `<p>Email: ${appState.customer.email}</p>`
                        : ""
                    }
                </div>
            </div>

            <table class="invoice-table">
                <thead>
                    <tr>
                        <th>Deskripsi</th>
                        <th class="text-center">Qty</th>
                        <th class="text-right">Harga Satuan</th>
                        <th class="text-center">Pajak (%)</th>
                        <th class="text-right">Diskon</th>
                        <th class="text-right">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${appState.items
                      .map(
                        (item) => `
                        <tr>
                            <td>${item.description || "Item"}</td>
                            <td class="text-center">${item.quantity || 0}</td>
                            <td class="text-right">${formatRupiah(
                              item.unitPrice || 0
                            )}</td>
                            <td class="text-center">${item.itemTax || 0}%</td>
                            <td class="text-right">${formatRupiah(
                              item.itemDiscount || 0
                            )}</td>
                            <td class="text-right"><strong>${formatRupiah(
                              calculateItemTotal(item)
                            )}</strong></td>
                        </tr>
                    `
                      )
                      .join("")}
                </tbody>
            </table>

            <div class="invoice-summary">
                <table class="summary-table">
                    <tr>
                        <td>Subtotal:</td>
                        <td>${formatRupiah(subtotal)}</td>
                    </tr>
                    ${
                      globalDiscount > 0
                        ? `
                        <tr>
                            <td>Diskon Global:</td>
                            <td>(${formatRupiah(globalDiscount)})</td>
                        </tr>
                    `
                        : ""
                    }
                    ${
                      appState.settings.enablePPN
                        ? `
                        <tr>
                            <td>PPN ${appState.settings.ppnRate}%:</td>
                            <td>${formatRupiah(ppn)}</td>
                        </tr>
                    `
                        : ""
                    }
                    ${
                      shipping > 0
                        ? `
                        <tr>
                            <td>Ongkos Kirim:</td>
                            <td>${formatRupiah(shipping)}</td>
                        </tr>
                    `
                        : ""
                    }
                    <tr class="total-row">
                        <td>TOTAL:</td>
                        <td>${formatRupiah(total)}</td>
                    </tr>
                </table>
            </div>

            ${
              appState.notes
                ? `
                <div class="invoice-notes">
                    <h4>Catatan:</h4>
                    <p>${appState.notes}</p>
                </div>
            `
                : ""
            }

            <div class="invoice-footer">
                <p>Terima kasih atas kepercayaan Anda kepada kami.</p>
                <p>Pembayaran mohon dilakukan sesuai dengan termin yang telah disepakati.</p>
            </div>
        </div>
    `;
}

/**
 * Format date to Indonesian format
 * @param {string} dateString - Date string in YYYY-MM-DD format
 * @returns {string} Formatted date string
 */
function formatDate(dateString) {
  if (!dateString) return "";

  const date = new Date(dateString);
  return date.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Update invoice preview
 */
function updateInvoicePreview() {
  const previewElement = document.getElementById("invoicePreview");
  const printAreaElement = document.getElementById("invoice-print-area");

  const invoiceHTML = generateInvoiceTemplate();
  previewElement.innerHTML = invoiceHTML;
  printAreaElement.innerHTML = invoiceHTML;
}

// Data Management Functions
/**
 * Save current state to JSON file
 */
function saveToJSON() {
  try {
    const dataToSave = {
      ...appState,
      exportDate: new Date().toISOString(),
      version: "1.0",
    };

    const dataStr = JSON.stringify(dataToSave, null, 2);
    const dataBlob = new Blob([dataStr], { type: "application/json" });

    const link = document.createElement("a");
    link.href = URL.createObjectURL(dataBlob);
    link.download = `invoice_${
      appState.invoiceMeta.invoiceNumber || "backup"
    }_${new Date().toISOString().split("T")[0]}.json`;

    // Trigger download
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clean up the URL object
    URL.revokeObjectURL(link.href);

    showMessage("Data berhasil disimpan sebagai file JSON!", "success");
  } catch (error) {
    console.error("Error saving JSON:", error);
    showMessage("Error menyimpan file: " + error.message, "error");
  }
}

/**
 * Load state from JSON file
 * @param {Event} event - File input change event
 */
  function handleLogoUpload(event) {
    const file = event.target.files[0];
    const preview = document.getElementById('logoPreview');
    const noLogoText = document.getElementById('noLogoText');

    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const dataUrl = e.target.result;
            // Simpan Base64 di state
            appState.seller.logoBase64 = dataUrl; 
            
            // Update preview di form
            preview.src = dataUrl;
            preview.style.display = 'block';
            noLogoText.style.display = 'none';

            updateInvoicePreview(); // Update preview invoice
        };
        reader.readAsDataURL(file);
    } else {
        // Reset logo
        appState.seller.logoBase64 = null;
        preview.src = "";
        preview.style.display = 'none';
        noLogoText.style.display = 'block';
        updateInvoicePreview();
    }
}


function loadFromJSON(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const loadedData = JSON.parse(e.target.result);

      // Validate and load data
      if (loadedData.seller && loadedData.customer && loadedData.items) {
        appState = {
          ...appState,
          ...loadedData,
        };

        populateFormFromState();
        renderItemsTable();
        updateSummary();
        updateInvoicePreview();

        showMessage("Data berhasil dimuat dari file JSON!", "success");
      } else {
        throw new Error("Format file tidak valid");
      }
    } catch (error) {
      console.error("Error loading JSON:", error);
      showMessage("Error memuat file: " + error.message, "error");
    }
  };
  reader.readAsText(file);

  // Reset file input
  event.target.value = "";
}

/**
 * Reset form to initial state
 */
function resetForm() {
  if (
    confirm("Apakah Anda yakin ingin mereset form? Semua data akan hilang.")
  ) {
    try {
      // Reset state
      appState = {
        seller: {
          companyName: "",
          address: "",
          npwp: "",
          phone: "",
          email: "",
        },
        customer: {
          companyName: "",
          contactPerson: "",
          address: "",
          email: "",
          phone: "",
        },
        invoiceMeta: {
          invoiceNumber: "",
          invoiceDate: "",
          dueDate: "",
          paymentTerms: "",
        },
        items: [],
        settings: {
          enablePPN: false,
          ppnRate: 11,
          globalDiscount: 0,
          shippingCost: 0,
        },
        notes: "",
      };

      // Generate new invoice number and set today's date
      appState.invoiceMeta.invoiceNumber = generateInvoiceNumber();
      appState.invoiceMeta.invoiceDate = new Date().toISOString().split("T")[0];

      // Update form and displays
      populateFormFromState();
      renderItemsTable();
      updateSummary();
      updateInvoicePreview();

      showMessage("Form berhasil direset!", "success");
    } catch (error) {
      console.error("Error resetting form:", error);
      showMessage("Error mereset form: " + error.message, "error");
    }
  }
}

// PDF Generation
/**
 * Generate PDF from invoice template
 */
async function generatePDF() {
  console.log("Generate PDF clicked!");
  const button = document.getElementById("generatePdfBtn");
  const originalText = button.textContent;

  console.log("check  library");

  const worker = html3pdf(); // Or:  const worker = new html3pdf.Worker;

  try {
    // Validate form
    if (!validateForm()) {
      showMessage("Mohon lengkapi semua field yang wajib diisi!", "error");
      return;
    }

    if (appState.items.length === 0) {
      showMessage("Mohon tambahkan minimal satu item!", "error");
      return;
    }

    // Show loading state
    button.textContent = "Generating PDF...";
    button.classList.add("loading");
    button.disabled = true;

    // Update print area with latest data
    updateInvoicePreview();

    // Wait a brief moment for DOM to update
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check if html3pdf is available
    if (typeof html3pdf === "undefined") {
      throw new Error(
        "html3pdf library tidak tersedia. Mohon periksa koneksi internet."
      );
    }

    // PDF generation options
    const opt = {
      margin: 10,
      filename: `${appState.invoiceMeta.invoiceNumber || "invoice"}.pdf`,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: {
        scale: 3,
        useCORS: true,
        allowTaint: true,
        logging: false,
        height: window.innerHeight,
        width: window.innerWidth,
      },
      jsPDF: {
        unit: "mm",
        format: "a4",
        orientation: "portrait",
      },
    };

    //console.log contohh

    // Generate PDF
    const element = document.getElementById("invoice-print-area");
    if (!element) {
      //
      throw new Error("Element invoice tidak ditemukan");
    }

    // This will implicitly create the canvases and PDF objects before saving.
    // const worker = html3pdf().from(element).save();

    await html3pdf().set(opt).from(element).save();

    console.log("elemet", element);

    showMessage("PDF berhasil dihasilkan dan diunduh!", "success");
  } catch (error) {
    console.error("PDF generation error:", error);
    showMessage("Error generating PDF: " + error.message, "error");
  } finally {
    // Reset button state
    button.textContent = originalText;
    button.classList.remove("loading");
    button.disabled = false;
  }
}

// Form Validation
/**
 * Validate form inputs
 * @returns {boolean} Validation result
 */
function validateForm() {
  let isValid = true;

  // Clear previous error states
  document.querySelectorAll(".form-control.error").forEach((el) => {
    el.classList.remove("error");
  });

  // Required fields validation
  const requiredFields = [
    { id: "sellerCompany", value: appState.seller.companyName },
    { id: "sellerAddress", value: appState.seller.address },
    { id: "customerCompany", value: appState.customer.companyName },
    { id: "customerContact", value: appState.customer.contactPerson },
    { id: "customerAddress", value: appState.customer.address },
    { id: "invoiceDate", value: appState.invoiceMeta.invoiceDate },
  ];

  requiredFields.forEach(({ id, value }) => {
    const element = document.getElementById(id);
    if (!value || value.trim() === "") {
      element.classList.add("error");
      isValid = false;
    }
  });

  // Validate numeric fields
  appState.items.forEach((item) => {
    if (item.quantity < 0 || item.unitPrice < 0) {
      isValid = false;
    }
  });

  return isValid;
}

// Utility Functions
/**
 * Show message to user
 * @param {string} message - Message text
 * @param {string} type - Message type ('success', 'error', 'info')
 */
function showMessage(message, type = "info") {
  // Remove existing messages
  const existingMessages = document.querySelectorAll(".message");
  existingMessages.forEach((msg) => msg.remove());

  // Create message element
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${
    type === "success" ? "success-message" : "error-message"
  }`;
  messageDiv.textContent = message;

  // Insert message
  const container = document.querySelector(".container");
  if (container) {
    container.insertBefore(messageDiv, container.firstChild);

    // Auto remove after 5 seconds
    setTimeout(() => {
      if (messageDiv.parentNode) {
        messageDiv.remove();
      }
    }, 5000);
  }
}

/**
 * Populate form fields from application state
 */
function populateFormFromState() {
  // Seller info
  document.getElementById("sellerCompany").value =
    appState.seller.companyName || "";
  document.getElementById("sellerAddress").value =
    appState.seller.address || "";
  document.getElementById("sellerNPWP").value = appState.seller.npwp || "";
  document.getElementById("sellerPhone").value = appState.seller.phone || "";
  document.getElementById("sellerEmail").value = appState.seller.email || "";
  
  const preview = document.getElementById('logoPreview');
  const noLogoText = document.getElementById('noLogoText');
  if (appState.seller.logoBase64) {
      preview.src = appState.seller.logoBase64;
      preview.style.display = 'block';
      noLogoText.style.display = 'none';
  } else {
      preview.src = "";
      preview.style.display = 'none';
      noLogoText.style.display = 'block';
  }

  // Customer info
  document.getElementById("customerCompany").value =
    appState.customer.companyName || "";
  document.getElementById("customerContact").value =
    appState.customer.contactPerson || "";
  document.getElementById("customerAddress").value =
    appState.customer.address || "";
  document.getElementById("customerEmail").value =
    appState.customer.email || "";
  document.getElementById("customerPhone").value =
    appState.customer.phone || "";

  // Invoice meta
  document.getElementById("invoiceNumber").value =
    appState.invoiceMeta.invoiceNumber || "";
  document.getElementById("invoiceDate").value =
    appState.invoiceMeta.invoiceDate || "";
  document.getElementById("dueDate").value = appState.invoiceMeta.dueDate || "";
  document.getElementById("paymentTerms").value =
    appState.invoiceMeta.paymentTerms || "";
  document.getElementById("invoiceNotes").value = appState.notes || "";

  // Settings
  document.getElementById("enablePPN").checked =
    appState.settings.enablePPN || false;
  document.getElementById("globalDiscount").value =
    appState.settings.globalDiscount || "";
  document.getElementById("shippingCost").value =
    appState.settings.shippingCost || "";
}

/**
 * Load sample data for testing
 */
function loadSampleData() {
  const sampleData = {
    seller: {
      companyName: "PT. Example Indonesia",
      address: "Jl. Contoh No. 123, Jakarta Selatan 12345",
      npwp: "01.234.567.8-901.000",
      phone: "+62 21 1234 5678",
      email: "info@example.co.id",
    },
    customer: {
      companyName: "CV. Client Baik",
      contactPerson: "John Doe",
      address: "Jl. Customer 456, Bandung 40123",
      email: "john@clientbaik.com",
      phone: "+62 22 8765 4321",
    },
    invoiceMeta: {
      invoiceNumber: generateInvoiceNumber(),
      invoiceDate: new Date().toISOString().split("T")[0],
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0], // 30 days from now
      paymentTerms: "Net 30",
    },
    items: [
      {
        id: 1,
        description: "Website Development - Landing Page",
        quantity: 1,
        unitPrice: 5000000,
        itemTax: 0,
        itemDiscount: 0,
      },
      {
        id: 2,
        description: "SEO Optimization Package",
        quantity: 3,
        unitPrice: 1500000,
        itemTax: 0,
        itemDiscount: 250000,
      },
      {
        id: 3,
        description: "Content Management Training",
        quantity: 2,
        unitPrice: 750000,
        itemTax: 0,
        itemDiscount: 0,
      },
    ],
    settings: {
      enablePPN: true,
      ppnRate: 11,
      globalDiscount: 0,
      shippingCost: 50000,
    },
    notes:
      "Terima kasih atas kepercayaan Anda. Pembayaran mohon dilakukan sesuai dengan termin yang telah disepakati.",
  };

  appState = { ...appState, ...sampleData };
}

// Event Listeners Setup
/**
 * Initialize application event listeners
 */
function initializeEventListeners() {
  document.getElementById("logoUpload").addEventListener("change", handleLogoUpload);

  const inputMappings = {
    sellerCompany: ["seller", "companyName"],
    sellerAddress: ["seller", "address"],
    sellerNPWP: ["seller", "npwp"],
    sellerPhone: ["seller", "phone"],
    sellerEmail: ["seller", "email"],
    customerCompany: ["customer", "companyName"],
    customerContact: ["customer", "contactPerson"],
    customerAddress: ["customer", "address"],
    customerEmail: ["customer", "email"],
    customerPhone: ["customer", "phone"],
    invoiceDate: ["invoiceMeta", "invoiceDate"],
    dueDate: ["invoiceMeta", "dueDate"],
    paymentTerms: ["invoiceMeta", "paymentTerms"],
    invoiceNotes: ["notes"],

  };

  document.getElementById('globalDiscount').addEventListener('input', function () {
  appState.settings.globalDiscount = parseFloat(this.value) || 0;
  updateSummary();
  updateInvoicePreview();
});

document.getElementById('globalDiscountType').addEventListener('change', function () {
  appState.settings.globalDiscountType = this.value;
  updateSummary();
  updateInvoicePreview();
});


  Object.keys(inputMappings).forEach((inputId) => {
    const element = document.getElementById(inputId);
    if (element) {
      element.addEventListener("input", function () {
        const mapping = inputMappings[inputId];
        if (mapping.length === 1) {
          appState[mapping[0]] = this.value;
        } else {
          appState[mapping[0]][mapping[1]] = this.value;
        }
        updateInvoicePreview();
      });
    }
  });

  // Settings listeners
  document.getElementById("enablePPN").addEventListener("change", function () {
    appState.settings.enablePPN = this.checked;
    updateSummary();
    updateInvoicePreview();
  });

  document
    .getElementById("globalDiscount")
    .addEventListener("input", function () {
      appState.settings.globalDiscount = parseFloat(this.value) || 0;
      updateSummary();
      updateInvoicePreview();
    });

  document
    .getElementById("shippingCost")
    .addEventListener("input", function () {
      appState.settings.shippingCost = parseFloat(this.value) || 0;
      updateSummary();
      updateInvoicePreview();
    });

  // Action buttons
  document.getElementById("addItemBtn").addEventListener("click", addItem);
  document.getElementById("resetBtn").addEventListener("click", resetForm);
  document.getElementById("saveJsonBtn").addEventListener("click", saveToJSON);
  document.getElementById("loadJsonBtn").addEventListener("click", () => {
    document.getElementById("loadJsonInput").click();
  });
  document
    .getElementById("loadJsonInput")
    .addEventListener("change", loadFromJSON);
  document
    .getElementById("generatePdfBtn")
    .addEventListener("click", generatePDF);
}

// HAPUS initializeApp yang lama dan ganti dengan struktur ini:

function initializeAppContent() {
    // Ini adalah fungsi yang berisi semua logika inisialisasi aplikasi (dijalankan SETELAH LOGIN)
    console.log("Initializing Invoice Generator Application Content...");
    // Pastikan event listener untuk PDF di sini, bukan di initializeApp
    document.getElementById("generatePdfBtn").addEventListener("click", generatePDF);

    try {
        loadSampleData();
        populateFormFromState();
        initializeEventListeners(); // Memuat semua listener form
        renderItemsTable();
        updateSummary();
        updateInvoicePreview();
        console.log("Application content initialized successfully!");
    } catch (error) {
        console.error("Error initializing application content:", error);
        showMessage("Error menginisialisasi aplikasi: " + error.message, "error");
    }
}

function initializeApp() {
    // 1. Setup event listeners untuk Login
    document.getElementById('loginBtn').addEventListener('click', handleLogin);
    document.getElementById('passwordInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleLogin();
        }
    });

    // 2. Cek status login
    checkLoginStatus();

    // 3. Jika sudah login, muat konten aplikasi
    if (localStorage.getItem('isLoggedIn') === 'true') {
        initializeAppContent();
    }
}

// Panggil initializeApp baru (diletakkan di akhir file)
document.addEventListener("DOMContentLoaded", initializeApp);

function checkLoginStatus() {
    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    const loginPage = document.getElementById('login-page');
    const appContent = document.getElementById('appContent');

    if (isLoggedIn) {
        loginPage.classList.add('hidden');
        appContent.classList.remove('hidden');
    } else {
        loginPage.classList.remove('hidden');
        appContent.classList.add('hidden');
    }
}

function handleLogin() {
  const usernameInput = document.getElementById("usernameInput").value.trim();
  const passwordInput = document.getElementById("passwordInput").value;
  const loginMessage = document.getElementById("loginMessage");

  if (usernameInput === SECRETUSERNAME && passwordInput === SECRETPASSWORD) {
    localStorage.setItem("isLoggedIn", true);
    loginMessage.className = "success-message";
    loginMessage.textContent = "Login berhasil! Memuat aplikasi...";
    setTimeout(() => {
      checkLoginStatus();
      initializeAppContent();
    }, 500);
  } else {
    loginMessage.className = "error-message";
    loginMessage.textContent = "Username atau kata sandi salah. Silakan coba lagi.";
    document.getElementById("passwordInput").value = "";
  }
}

function handleLogout() {
  localStorage.removeItem("isLoggedIn");
  checkLoginStatus();
}

document.getElementById("loginBtn").addEventListener("click", handleLogin);
document.getElementById("logoutBtn").addEventListener("click", handleLogout);
document.getElementById("passwordInput").addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    handleLogin();
  }
});

checkLoginStatus();

