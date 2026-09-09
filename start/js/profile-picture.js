const PROFILE_SELECTORS = '#imgProfile, #fotoperfil, #fotoperfiltoda, #perfiltfotto';
const PIC_STORAGE_KEY = 'picwpp';
const PIC_PHONE_KEY = 'picwpp_phone';

// Dedupe: evita request paralela do mesmo número (auto-load + chamada manual)
const inflightByPhone = new Map();

function digitsOnly(value) {
    return String(value || '').replace(/\D/g, '');
}

function normalizePhone(value) {
    let phone = digitsOnly(value);
    if (!phone) return '';
    if (phone.startsWith('55') && phone.length > 11) {
        phone = phone.substring(2);
    }
    return phone;
}

function resolvePhoneNumber() {
    const fromStorage = localStorage.getItem('userFormattedNumber');
    if (fromStorage) {
        const phone = digitsOnly(fromStorage);
        if (phone.length >= 10) return phone;
    }

    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('celular') || params.get('numero') || '';
    const phone = digitsOnly(fromUrl);
    if (phone.length >= 10) return phone;

    return '';
}

function updateImageElement(imageUrl) {
    if (!imageUrl) return;

    // concluido2 já define atualizarImagem para os IDs corretos
    if (typeof atualizarImagem === 'function') {
        try {
            atualizarImagem(imageUrl);
        } catch (err) {
            console.error('Erro em atualizarImagem:', err);
        }
    }

    const elements = document.querySelectorAll(PROFILE_SELECTORS);
    if (!elements.length) {
        console.error('Nenhum elemento de perfil encontrado:', PROFILE_SELECTORS);
        return;
    }

    elements.forEach((imgElement) => {
        imgElement.src = imageUrl;
        imgElement.classList.add('imagemArredondada');
    });

    console.log('Imagem atualizada na UI:', imageUrl, `(${elements.length} elemento(s))`);
}

async function getWhatsAppProfilePicture(phoneOverride) {
    try {
        const rawPhone = phoneOverride || resolvePhoneNumber();

        if (!rawPhone || rawPhone.length < 10) {
            console.log('Número não encontrado (localStorage/URL)');
            return null;
        }

        const cleanPhone = normalizePhone(rawPhone);

        if (cleanPhone.length < 10) {
            console.log('Número inválido:', cleanPhone);
            return null;
        }

        if (inflightByPhone.has(cleanPhone)) {
            console.log('Request já em andamento para:', cleanPhone);
            return inflightByPhone.get(cleanPhone);
        }

        console.log('Buscando foto para o número:', cleanPhone);

        const requestPromise = (async () => {
            const response = await fetch(
                `/api/profile-picture?phone=${encodeURIComponent(cleanPhone)}&timestamp=${Date.now()}`
            );

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            if (data.success && data.image) {
                localStorage.setItem(PIC_STORAGE_KEY, data.image);
                localStorage.setItem(PIC_PHONE_KEY, cleanPhone);
                console.log('Foto de perfil salva no localStorage:', data.image);
                updateImageElement(data.image);
                return data.image;
            }

            console.log('Foto não encontrada:', data.error || 'Erro desconhecido');
            return null;
        })();

        inflightByPhone.set(cleanPhone, requestPromise);

        try {
            return await requestPromise;
        } finally {
            inflightByPhone.delete(cleanPhone);
        }
    } catch (error) {
        console.error('Erro ao buscar foto de perfil:', error);
        return null;
    }
}

function loadProfilePicture(phoneOverride) {
    const rawPhone = phoneOverride || resolvePhoneNumber();
    const cleanPhone = normalizePhone(rawPhone);
    const savedPicture = localStorage.getItem(PIC_STORAGE_KEY);
    const savedPhone = localStorage.getItem(PIC_PHONE_KEY);

    // Só reutiliza cache se for do mesmo número
    if (savedPicture && cleanPhone && savedPhone === cleanPhone) {
        console.log('Foto em cache para o número atual:', cleanPhone);
        updateImageElement(savedPicture);
        return savedPicture;
    }

    if (savedPicture && cleanPhone && savedPhone && savedPhone !== cleanPhone) {
        console.log('Cache de foto de outro número — limpando e buscando de novo');
        localStorage.removeItem(PIC_STORAGE_KEY);
        localStorage.removeItem(PIC_PHONE_KEY);
    }

    getWhatsAppProfilePicture(rawPhone || cleanPhone);
    return null;
}

// Compatibilidade com o HTML (chamada explícita opcional)
function fetchProfilePicture(phoneNumber) {
    console.log('fetchProfilePicture chamada para:', phoneNumber);
    loadProfilePicture(phoneNumber);
}

if (typeof window !== 'undefined') {
    window.getWhatsAppProfilePicture = getWhatsAppProfilePicture;
    window.loadProfilePicture = loadProfilePicture;
    window.fetchProfilePicture = fetchProfilePicture;
    window.updateImageElement = updateImageElement;

    document.addEventListener('DOMContentLoaded', function () {
        setTimeout(() => {
            loadProfilePicture();
        }, 500);
    });
}
