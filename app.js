const SUPERADMIN_USER = "admin_master";
const MAX_FIELDS_PER_CATEGORY = 20;
const MAX_GRADE_FIELDS = 5;
const MAX_SUBJECTS_PER_GRADE = 12;
const MAX_LEARNING_CONTENTS = 100;
const MAX_ARTICLE_WORDS = 5000;
const MAX_ARTICLES_PER_CONTENT = 3;
const MAX_QUIZZES_PER_CONTENT = 20;
const MAX_QUIZ_QUESTION_CHARS = 300;
const MAX_QUIZ_OPTION_CHARS = 80;
const MAX_LINKS_PER_CONTENT = 20;

        let rolSesionActiva = null; // 'superadmin', 'admin_menor', 'estudiante', null
        let adminMenorDatos = null;
        let usuarioActual = null;
        let pestanaActualBiblioteca = 'avanzados';
        let campoActualIndex = null;
        let subMateriaActualIndex = null;
        let solicitudIndexEnProceso = null;
        let guardadoPendiente = Promise.resolve();
        let guardadosLocalesPendientes = 0;
        let sincronizacionAdminEnCurso = false;
        let adminSyncTimer = null;
        let datosBD = null;
        let opcionesProgresoAdmin = [];

        function fetchApi(url, options = {}) {
            const headers = new Headers(options.headers || {});
            const accessToken = sessionStorage.getItem('platformAccessToken');
            if (accessToken) headers.set('X-Platform-Access', accessToken);
            return fetch(url, { ...options, headers });
        }

        function crearIdContenido() {
            return `contenido_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        }

        function asegurarIdsCampos(campos) {
            let modificados = false;
            for (const [categoria, lista] of Object.entries(campos)) {
                lista.forEach((campo, index) => {
                    if (!campo.id) {
                        campo.id = `legacy_${categoria}_${index}`;
                        modificados = true;
                    }
                    if (Object.hasOwn(campo, 'pdfs')) {
                        delete campo.pdfs;
                        modificados = true;
                    }
                    if (!Array.isArray(campo.sitiosWeb)) {
                        campo.sitiosWeb = [];
                        modificados = true;
                    }
                    (campo.materias || []).forEach((materia, materiaIndex) => {
                        if (!materia.id) {
                            materia.id = `legacy_${categoria}_${index}_materia_${materiaIndex}`;
                            modificados = true;
                        }
                        if (Object.hasOwn(materia, 'pdfs')) {
                            delete materia.pdfs;
                            modificados = true;
                        }
                        if (!Array.isArray(materia.sitiosWeb)) {
                            materia.sitiosWeb = [];
                            modificados = true;
                        }
                    });
                });
            }
            return modificados;
        }

        function contarCamposYMaterias(campos) {
            return (campos.avanzados || []).length
                + (campos.generales || []).length
                + (campos.grados || []).reduce(
                    (total, grado) => total + (grado.materias || []).length,
                    0
                );
        }

        function contarPalabras(texto) {
            const limpio = texto.trim();
            return limpio ? limpio.split(/\s+/).length : 0;
        }

        function actualizarConteoPalabrasArticulo() {
            const palabras = contarPalabras(
                document.getElementById('artInputTextoContinuo').value
            );
            const conteo = document.getElementById('articleWordCount');
            conteo.textContent = `${palabras} de ${MAX_ARTICLE_WORDS} palabras`;
            conteo.classList.toggle('limit-exceeded', palabras > MAX_ARTICLE_WORDS);
        }

        function actualizarConteosCuestionario() {
            for (const [id, contadorId, maximo] of [
                ['qInputPregunta', 'quizQuestionCount', MAX_QUIZ_QUESTION_CHARS],
                ['qInputOpt1', 'quizOption1Count', MAX_QUIZ_OPTION_CHARS],
                ['qInputOpt2', 'quizOption2Count', MAX_QUIZ_OPTION_CHARS],
                ['qInputOpt3', 'quizOption3Count', MAX_QUIZ_OPTION_CHARS]
            ]) {
                document.getElementById(contadorId).textContent =
                    `${document.getElementById(id).value.length} de ${maximo} caracteres`;
            }
        }

        const camposIniciales = {
            avanzados: [
                {
                    id: "av_1",
                    titulo: "Ingeniería Civil y Estructuras",
                    resumen: "Diseño y construcción de grandes infraestructuras resistentes.",
                    contenido: "La ingeniería civil abarca el diseño, mantenimiento y gestión de infraestructuras indispensables como carreteras, puentes y presas.",
                    adminAsignado: null,
                    cuestionarios: [],
                    articulos: [],
                }
            ],
            generales: [
                {
                    id: "gen_1",
                    titulo: "Fundamentos de Computación",
                    resumen: "Introducción al hardware, software y lógica de programación.",
                    contenido: "La computación moderna se basa en la ejecución rápida de instrucciones binarias a través de microprocesadores.",
                    adminAsignado: null,
                    cuestionarios: [],
                    articulos: [],
                }
            ],
            grados: [
                {
                    id: "gr_1",
                    titulo: "1er Año de Educación Secundaria",
                    resumen: "Materias fundamentales para el primer año de bachillerato.",
                    contenido: "Plan de estudio básico correspondiente al primer año.",
                    adminAsignado: null,
                    cuestionarios: [],
                    articulos: [],
                    materias: []
                },
                {
                    id: "gr_2",
                    titulo: "2do Año de Educación Secundaria",
                    resumen: "Materias para el segundo año de secundaria.",
                    contenido: "Plan de estudio correspondiente al segundo año.",
                    adminAsignado: null,
                    cuestionarios: [],
                    articulos: [],
                    materias: []
                },
                {
                    id: "gr_3",
                    titulo: "3er Año de Educación Secundaria",
                    resumen: "Materias para el tercer año de secundaria.",
                    contenido: "Plan de estudio correspondiente al tercer año.",
                    adminAsignado: null,
                    cuestionarios: [],
                    articulos: [],
                    materias: []
                },
                {
                    id: "gr_4",
                    titulo: "4to Año de Educación Secundaria",
                    resumen: "Materias orientadas a las ciencias y humanidades de cuarto año.",
                    contenido: "Plan de estudio correspondiente al cuarto año.",
                    adminAsignado: null,
                    cuestionarios: [],
                    articulos: [],
                    materias: []
                },
                {
                    id: "gr_5",
                    titulo: "5to Año de Educación Secundaria",
                    resumen: "Materias especializadas del último año de bachillerato.",
                    contenido: "Plan de estudio avanzado correspondiente al quinto año.",
                    adminAsignado: null,
                    cuestionarios: [],
                    articulos: [],
                    materias: [
                        {
                            titulo: "Robótica y Automatización 5to Año",
                            resumen: "Sistemas de control y automatismos para 5to año.",
                            contenido: "Estudio de microcontroladores y sensores aplicados.",
                            adminAsignado: null,
                            cuestionarios: [],
                            articulos: []
                        }
                    ]
                }
            ]
        };

        function obtenerCamposBD() {
            if (datosBD) return datosBD.fields;
            let data = localStorage.getItem('pi_campos_bd_v9');
            if (!data) {
                localStorage.setItem('pi_campos_bd_v9', JSON.stringify(camposIniciales));
                return camposIniciales;
            }
            return JSON.parse(data);
        }

        function guardarCamposBD(campos) {
            if (datosBD) {
                datosBD.fields = campos;
                programarGuardadoBD();
                return;
            }
            try {
                localStorage.setItem('pi_campos_bd_v9', JSON.stringify(campos));
            } catch (e) {
                alert("Advertencia: El almacenamiento local está lleno.");
                return;
            }
            programarGuardadoBD();
        }

        function obtenerUsuariosBD() {
            if (datosBD) return datosBD.users;
            let users = localStorage.getItem('pi_usuarios_bd_v9');
            return users ? JSON.parse(users) : [];
        }

        function guardarUsuariosBD(users) {
            if (datosBD) {
                datosBD.users = users;
                return programarGuardadoBD();
            }
            localStorage.setItem('pi_usuarios_bd_v9', JSON.stringify(users));
            return programarGuardadoBD();
        }

        function obtenerAdminsBD() {
            if (datosBD) return datosBD.admins;
            let admins = localStorage.getItem('pi_admins_bd_v9');
            return admins ? JSON.parse(admins) : [];
        }

        function guardarAdminsBD(admins) {
            if (datosBD) {
                datosBD.admins = admins;
                programarGuardadoBD();
                return;
            }
            localStorage.setItem('pi_admins_bd_v9', JSON.stringify(admins));
            programarGuardadoBD();
        }

        function obtenerSolicitudesBD() {
            if (datosBD) return datosBD.requests;
            let reqs = localStorage.getItem('pi_solicitudes_bd_v9');
            return reqs ? JSON.parse(reqs) : [];
        }

        function guardarSolicitudesBD(reqs) {
            if (datosBD) {
                datosBD.requests = reqs;
                return programarGuardadoBD();
            }
            localStorage.setItem('pi_solicitudes_bd_v9', JSON.stringify(reqs));
            return programarGuardadoBD();
        }

        function obtenerEstadoBDLocal() {
            return {
                users: obtenerUsuariosBD(),
                admins: obtenerAdminsBD(),
                requests: obtenerSolicitudesBD(),
                fields: obtenerCamposBD()
            };
        }

        function aplicarEstadoBD(estado) {
            if (!estado || !estado.fields) {
                estado = {
                    users: [],
                    admins: [],
                    requests: [],
                    fields: { avanzados: [], generales: [], grados: [] }
                };
            }
            asegurarIdsCampos(estado.fields);
            datosBD = estado;
        }

        function mostrarErrorBaseDatos(error) {
            const estado = document.getElementById('dbStatus');
            const instrucciones = location.protocol === 'file:'
                ? 'No abras index.html directamente. Haz doble clic en "Iniciar plataforma.bat" y usa la dirección que se abra en el navegador.'
                : `Confirma que el servidor siga abierto y visita ${location.origin}.`;
            estado.textContent = `No se pudo conectar con la base de datos (${error.message}). ${instrucciones}`;
            estado.hidden = false;
            establecerControlesHabilitados(false);
            console.error('Error de conexión con la base de datos:', error);
        }

        function programarGuardadoBD() {
            const snapshot = obtenerEstadoBDLocal();
            guardadosLocalesPendientes++;
            guardadoPendiente = guardadoPendiente.then(async () => {
                const respuesta = await fetchApi('/api/state', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(snapshot)
                });
                if (!respuesta.ok) {
                    throw new Error(`El servidor respondió ${respuesta.status}.`);
                }
                document.getElementById('dbStatus').hidden = true;
                establecerControlesHabilitados(true);
                return true;
            }).catch(error => {
                mostrarErrorBaseDatos(error);
                return false;
            }).finally(() => {
                guardadosLocalesPendientes--;
            });
            return guardadoPendiente;
        }

        function establecerControlesHabilitados(habilitado) {
            document.querySelectorAll('button, input, textarea, select').forEach(control => {
                control.disabled = !habilitado;
            });
        }

        async function inicializarBaseDatos() {
            establecerControlesHabilitados(false);
            try {
                let respuesta = await fetchApi('/api/state');
                if (respuesta.status === 401) {
                    respuesta = await fetchApi('/api/state');
                }
                if (!respuesta.ok) {
                    throw new Error(`El servidor respondió ${respuesta.status}.`);
                }

                const resultado = await respuesta.json();
                aplicarEstadoBD(resultado.state);

                if (resultado.session?.role === 'superadmin') {
                    rolSesionActiva = 'superadmin';
                    adminMenorDatos = null;
                    usuarioActual = null;
                    activarInterfazPlataforma('Superadmin Principal', 'superadmin');
                } else if (resultado.session?.role === 'admin') {
                    const username = resultado.session.username.toLowerCase();
                    adminMenorDatos = obtenerAdminsBD().find(
                        admin => admin.user?.toLowerCase() === username
                    );
                    if (adminMenorDatos) {
                        rolSesionActiva = 'admin_menor';
                        usuarioActual = null;
                        activarInterfazPlataforma(adminMenorDatos.nombre, 'admin_menor');
                    }
                } else if (resultado.session?.role === 'student') {
                    const username = resultado.session.username
                        .replace(/\s+/g, ' ')
                        .trim()
                        .toLocaleLowerCase();
                    usuarioActual = obtenerUsuariosBD().find(
                        user => user.nombre?.replace(/\s+/g, ' ')
                            .trim()
                            .toLocaleLowerCase() === username
                    );
                    if (usuarioActual) {
                        rolSesionActiva = 'estudiante';
                        activarInterfazPlataforma(usuarioActual.nombre, 'estudiante');
                    }
                }

                if (!rolSesionActiva) {
                    renderizarBibliotecaCampos();
                }
                establecerControlesHabilitados(true);
                if (!adminSyncTimer) {
                    adminSyncTimer = window.setInterval(sincronizarDatosAdmin, 2000);
                }
            } catch (error) {
                mostrarErrorBaseDatos(error);
            }
        }

        async function sincronizarDatosAdmin() {
            if (!['superadmin', 'admin_menor'].includes(rolSesionActiva)
                || guardadosLocalesPendientes > 0
                || sincronizacionAdminEnCurso) {
                return;
            }

            sincronizacionAdminEnCurso = true;
            try {
                const respuesta = await fetchApi('/api/admin-updates');
                if (!respuesta.ok) {
                    throw new Error(`El servidor respondió ${respuesta.status}.`);
                }

                const resultado = await respuesta.json();
                if (!resultado.updates || guardadosLocalesPendientes > 0) return;

                const solicitudesCambiaron = JSON.stringify(datosBD.requests) !== JSON.stringify(resultado.updates.requests);
                const estudiantesCambiaron = JSON.stringify(datosBD.users) !== JSON.stringify(resultado.updates.users);
                if (solicitudesCambiaron) datosBD.requests = resultado.updates.requests;
                if (estudiantesCambiaron) datosBD.users = resultado.updates.users;

                if (rolSesionActiva === 'superadmin' && solicitudesCambiaron) {
                    renderizarSolicitudesYAdmins();
                }
                if (estudiantesCambiaron) cargarTablaUsuariosAdmin();

                document.getElementById('dbStatus').hidden = true;
                establecerControlesHabilitados(true);
            } catch (error) {
                mostrarErrorBaseDatos(error);
            } finally {
                sincronizacionAdminEnCurso = false;
            }
        }

        function normalizarTexto(txt) {
            return txt.trim().toLowerCase().replace(/\s+/g, ' ');
        }

        async function verificarCodigoIngreso() {
            const accessGate = document.getElementById('accessGate');
            const accessMessage = document.getElementById('accessCodeMessage');
            const accessInput = document.getElementById('platformAccessCode');
            const code = accessInput.value;
            if (code) {
                try {
                    const response = await fetchApi('/api/access-code/verify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ code })
                    });
                    const result = await response.json();
                    if (!response.ok) {
                        throw new Error(result.error || `El servidor respondió ${response.status}.`);
                    }
                    sessionStorage.setItem('platformAccessToken', result.token);
                    accessInput.value = '';
                    accessMessage.textContent = '';
                } catch (error) {
                    accessMessage.textContent = error.message;
                    accessInput.focus();
                    return;
                }
            }
            if (!sessionStorage.getItem('platformAccessToken')) {
                accessGate.hidden = false;
                return;
            }
            try {
                const response = await fetchApi('/api/state');
                if (response.status === 401) {
                    sessionStorage.removeItem('platformAccessToken');
                    accessGate.hidden = false;
                    accessMessage.textContent = 'La sesión de acceso venció. Ingresa el código general.';
                    return;
                }
                if (!response.ok) {
                    accessGate.hidden = true;
                    throw new Error(`El servidor respondió ${response.status}.`);
                }
                accessGate.hidden = true;
                await inicializarBaseDatos();
            } catch (error) {
                accessGate.hidden = true;
                mostrarErrorBaseDatos(error);
            }
        }

        async function cambiarCodigoIngreso() {
            if (rolSesionActiva !== 'superadmin') {
                alert('Solo el Administrador Principal puede cambiar el código general.');
                return;
            }
            const password = document.getElementById('currentAccessCodeAdminPassword').value;
            const newCode = document.getElementById('newPlatformAccessCode').value;
            const confirmCode = document.getElementById('confirmPlatformAccessCode').value;
            if (!password || !newCode || !confirmCode) {
                alert('Completa los tres campos del cambio de código.');
                return;
            }
            if (newCode.length < 6 || newCode.length > 128) {
                alert('El código nuevo debe tener entre 6 y 128 caracteres.');
                return;
            }
            if (newCode !== confirmCode) {
                alert('El código nuevo y su confirmación no coinciden.');
                return;
            }
            try {
                const response = await fetchApi('/api/platform-access-code', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: SUPERADMIN_USER,
                        password,
                        newCode
                    })
                });
                const result = await response.json();
                if (!response.ok) {
                    throw new Error(result.error || `El servidor respondió ${response.status}.`);
                }
                document.getElementById('currentAccessCodeAdminPassword').value = '';
                document.getElementById('newPlatformAccessCode').value = '';
                document.getElementById('confirmPlatformAccessCode').value = '';
                sessionStorage.removeItem('platformAccessToken');
                document.getElementById('accessGate').hidden = false;
                document.getElementById('accessCodeMessage').textContent =
                    'Código actualizado. Ingresa el nuevo código para continuar.';
            } catch (error) {
                alert(`No se pudo cambiar el código general: ${error.message}`);
            }
        }

        async function cargarEstadoSesion() {
            const respuesta = await fetchApi('/api/state');
            if (!respuesta.ok) throw new Error(`El servidor respondió ${respuesta.status}.`);
            const resultado = await respuesta.json();
            aplicarEstadoBD(resultado.state);
            renderizarBibliotecaCampos();
        }

        function cambiarVistaAuth(vista) {
            if (vista === 'login') {
                document.getElementById('cardRegistro').classList.add('hidden');
                document.getElementById('cardLogin').classList.remove('hidden');
            } else {
                document.getElementById('cardLogin').classList.add('hidden');
                document.getElementById('cardRegistro').classList.remove('hidden');
            }
            actualizarAccionesHeader();
        }

        function actualizarAccionesHeader() {
            const sesionActiva = rolSesionActiva !== null;
            const registroVisible = !document.getElementById('authSection').classList.contains('hidden')
                && !document.getElementById('cardRegistro').classList.contains('hidden');
            const modalAuthAbierto = ['adminModal', 'solicitudModal'].some(id =>
                !document.getElementById(id).classList.contains('hidden')
            );
            const mostrarAcciones = !sesionActiva && registroVisible && !modalAuthAbierto;

            document.querySelector('.btn-docente-header').classList.toggle('hidden', !mostrarAcciones);
            document.querySelector('.btn-solicitud-header').classList.toggle('hidden', !mostrarAcciones);
            document.getElementById('userStatus').classList.toggle('hidden', !sesionActiva && !mostrarAcciones);
            actualizarEnlaceBiblioteca();
        }

        function actualizarEnlaceBiblioteca() {
            const enlace = document.getElementById('libraryHomeLink');
            const dentroDeCampo = !document.getElementById('campoViewSection').classList.contains('hidden');
            const mostrarEnlace = rolSesionActiva !== null && dentroDeCampo;
            enlace.classList.toggle('hidden', !mostrarEnlace);
            enlace.textContent = rolSesionActiva === 'admin_menor'
                ? '← Volver a mis campos'
                : rolSesionActiva === 'superadmin'
                    ? '← Volver a administración'
                    : '← Volver a Biblioteca Principal';
        }

        function abrirModalAdmin() {
            document.getElementById('adminModal').classList.remove('hidden');
            actualizarAccionesHeader();
        }

        function cerrarModalAdmin() {
            document.getElementById('adminModal').classList.add('hidden');
            document.getElementById('adminUser').value = '';
            document.getElementById('adminPass').value = '';
            actualizarAccionesHeader();
        }

        function abrirModalSolicitud() {
            document.getElementById('solicitudModal').classList.remove('hidden');
            actualizarAccionesHeader();
        }

        function cerrarModalSolicitud() {
            document.getElementById('solicitudModal').classList.add('hidden');
            document.getElementById('solName').value = '';
            document.getElementById('solUser').value = '';
            document.getElementById('solPass').value = '';
            actualizarAccionesHeader();
        }

        async function solicitarAccesoAdmin() {
            const nombre = document.getElementById('solName').value.trim();
            const user = document.getElementById('solUser').value.trim();
            const pass = document.getElementById('solPass').value;

            if (!nombre || !user || !pass) {
                alert('Completa todos los campos para solicitar el acceso.');
                return;
            }

            try {
                const respuesta = await fetchApi('/api/admin-requests', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: nombre, username: user, password: pass })
                });
                const resultado = await respuesta.json();
                if (!respuesta.ok) {
                    alert(resultado.error || 'No se pudo enviar la solicitud.');
                    return;
                }
            } catch (error) {
                alert(`No se pudo enviar la solicitud: ${error.message}`);
                return;
            }

            cerrarModalSolicitud();
            alert('Solicitud enviada con éxito. El Administrador Principal la revisará.');
        }

        async function iniciarSesionAdmin() {
            const user = document.getElementById('adminUser').value.trim();
            const pass = document.getElementById('adminPass').value;

            try {
                const respuesta = await fetchApi('/api/admin-login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: user, password: pass })
                });
                const resultado = await respuesta.json();
                if (!respuesta.ok) {
                    alert(resultado.error || 'Credenciales administrativas incorrectas.');
                    return;
                }
                await cargarEstadoSesion();
                if (resultado.role === 'superadmin') {
                    rolSesionActiva = 'superadmin';
                    adminMenorDatos = null;
                    usuarioActual = null;
                    cerrarModalAdmin();
                    activarInterfazPlataforma('Superadmin Principal', 'superadmin');
                    return;
                }
                const adminEncontrado = obtenerAdminsBD().find(
                    admin => admin.user?.toLowerCase() === resultado.username
                );
                if (!adminEncontrado) {
                    throw new Error('La cuenta administrativa no tiene asignaciones vigentes.');
                }
                rolSesionActiva = 'admin_menor';
                adminMenorDatos = adminEncontrado;
                usuarioActual = null;
                cerrarModalAdmin();
                activarInterfazPlataforma(adminEncontrado.nombre, 'admin_menor');
            } catch (error) {
                alert(`No se pudo verificar el acceso administrativo: ${error.message}`);
            }
        }

        async function cambiarContrasenaAdmin() {
            if (!['superadmin', 'admin_menor'].includes(rolSesionActiva)) {
                alert('Esta opción está disponible únicamente para administradores.');
                return;
            }

            const currentPassword = document.getElementById('currentAdminPassword').value;
            const newPassword = document.getElementById('newAdminPassword').value;
            const confirmPassword = document.getElementById('confirmAdminPassword').value;
            if (!currentPassword || !newPassword || !confirmPassword) {
                alert('Completa los tres campos de contraseña.');
                return;
            }
            if (newPassword.length < 8 || newPassword.length > 128) {
                alert('La nueva contraseña debe tener entre 8 y 128 caracteres.');
                return;
            }
            if (newPassword !== confirmPassword) {
                alert('La nueva contraseña y su confirmación no coinciden.');
                return;
            }
            if (newPassword === currentPassword) {
                alert('La nueva contraseña debe ser distinta de la actual.');
                return;
            }

            const username = rolSesionActiva === 'superadmin' ? SUPERADMIN_USER : adminMenorDatos.user;
            try {
                await guardadoPendiente;
                const respuesta = await fetchApi('/api/admin-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, currentPassword, newPassword })
                });
                const resultado = await respuesta.json();
                if (!respuesta.ok) {
                    throw new Error(resultado.error || `El servidor respondió ${respuesta.status}.`);
                }

                if (rolSesionActiva === 'admin_menor') {
                    const admin = obtenerAdminsBD().find(item => item.user === username);
                    if (admin) admin.pass = newPassword;
                    adminMenorDatos.pass = newPassword;
                }
                document.getElementById('currentAdminPassword').value = '';
                document.getElementById('newAdminPassword').value = '';
                document.getElementById('confirmAdminPassword').value = '';
                alert('Contraseña actualizada. Usa la nueva contraseña en tu próximo inicio de sesión.');
            } catch (error) {
                alert(`No se pudo cambiar la contraseña: ${error.message}`);
            }
        }

        async function registrarUsuarioNuevo() {
            const nombre = document.getElementById('regName').value.trim();
            const grado = document.getElementById('regGrade').value;
            const pass = document.getElementById('regPass').value;

            if (!nombre || pass.length < 8) {
                alert('Ingresa tu Nombre Completo y una contraseña de al menos 8 caracteres.');
                return;
            }
            try {
                const respuesta = await fetchApi('/api/student/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: nombre, grade: grado, password: pass })
                });
                const resultado = await respuesta.json();
                if (!respuesta.ok) {
                    alert(resultado.error || 'No se pudo crear la cuenta.');
                    return;
                }
                await cargarEstadoSesion();
                ingresarEstudiante(datosBD.users[0]);
            } catch (error) {
                alert(`No se pudo crear la cuenta: ${error.message}`);
            }
        }

        async function iniciarSesionEstudiante() {
            const nombreIngresado = document.getElementById('loginName').value.trim();
            const pass = document.getElementById('loginPass').value;
            try {
                const respuesta = await fetchApi('/api/student/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: nombreIngresado, password: pass })
                });
                const resultado = await respuesta.json();
                if (!respuesta.ok) {
                    alert(resultado.error || 'Nombre o contraseña incorrectos.');
                    return;
                }
                await cargarEstadoSesion();
                ingresarEstudiante(datosBD.users[0]);
            } catch (error) {
                alert(`No se pudo iniciar sesión: ${error.message}`);
            }
        }

        function ingresarEstudiante(userObj) {
            rolSesionActiva = 'estudiante';
            usuarioActual = userObj;
            activarInterfazPlataforma(userObj.nombre, 'estudiante');
        }

        function activarInterfazPlataforma(nombre, rol) {
            document.getElementById('authSection').classList.add('hidden');
            document.getElementById('mainContent').classList.remove('hidden');

            if (rol === 'superadmin') {
                document.getElementById('userStatus').innerHTML = `👑 Admin Principal <button class="btn-logout" onclick="cerrarSesion()">Salir</button>`;
                document.getElementById('adminSecuritySection').classList.remove('hidden');
                document.getElementById('platformAccessCodeSection').classList.remove('hidden');
                document.getElementById('adminFieldSelector').classList.add('hidden');
                document.getElementById('adminDashboardTitle').classList.remove('hidden');
                document.getElementById('adminPanelSection').classList.remove('hidden');
                document.getElementById('superAdminRequestsSection').classList.remove('hidden');
                document.getElementById('adminUsersSection').classList.remove('hidden');
                document.getElementById('studentProgressBox').classList.add('hidden');
                renderizarSolicitudesYAdmins();
                cargarTablaUsuariosAdmin();
                renderizarBibliotecaCampos();
            } else if (rol === 'admin_menor') {
                document.getElementById('userStatus').innerHTML = `🔹 Admin: ${nombre} <button class="btn-logout" onclick="cerrarSesion()">Salir</button>`;
                document.getElementById('adminSecuritySection').classList.remove('hidden');
                document.getElementById('platformAccessCodeSection').classList.add('hidden');
                document.getElementById('adminDashboardTitle').classList.add('hidden');
                document.getElementById('adminPanelSection').classList.add('hidden');
                document.getElementById('superAdminRequestsSection').classList.add('hidden');
                document.getElementById('adminUsersSection').classList.remove('hidden');
                document.getElementById('studentProgressBox').classList.add('hidden');
                document.getElementById('bibliotecaSection').classList.add('hidden');
                cargarTablaUsuariosAdmin();

                const camposAsignados = obtenerCamposAsignadosAdmin(adminMenorDatos);
                if (camposAsignados.length === 1) {
                    abrirCampoAsignado(0);
                } else {
                    mostrarSelectorCamposAdmin();
                }
            } else {
                document.getElementById('userStatus').innerHTML = `🧑‍🎓 ${nombre} <button class="btn-logout" onclick="cerrarSesion()">Salir</button>`;
                document.getElementById('adminSecuritySection').classList.add('hidden');
                document.getElementById('adminFieldSelector').classList.add('hidden');
                document.getElementById('adminDashboardTitle').classList.add('hidden');
                document.getElementById('studentName').innerText = usuarioActual.nombre;
                document.getElementById('studentGradeText').innerText = usuarioActual.grado;
                document.getElementById('adminPanelSection').classList.add('hidden');
                document.getElementById('superAdminRequestsSection').classList.add('hidden');
                document.getElementById('adminUsersSection').classList.add('hidden');
                document.getElementById('studentProgressBox').classList.remove('hidden');
                actualizarProgresoEstudianteGlobal();
                renderizarBibliotecaCampos();
            }
            actualizarAccionesHeader();
        }

        async function cerrarSesion() {
            try {
                await fetchApi('/api/logout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: '{}'
                });
            } catch (error) {
                console.error('No se pudo cerrar la sesión en el servidor:', error);
            }
            document.getElementById('adminSecuritySection').open = false;
            rolSesionActiva = null;
            adminMenorDatos = null;
            usuarioActual = null;
            document.getElementById('authSection').classList.remove('hidden');
            document.getElementById('mainContent').classList.add('hidden');
            document.getElementById('userStatus').innerText = "No has iniciado sesión";
            document.getElementById('userStatus').classList.remove('hidden');
            cambiarVistaAuth('registro');
            volverABiblioteca();
            actualizarAccionesHeader();
            await inicializarBaseDatos();
        }

        function renderizarSolicitudesYAdmins() {
            const reqContainer = document.getElementById('requestsTableContainer');
            let reqs = obtenerSolicitudesBD();

            if (reqs.length === 0) {
                reqContainer.innerHTML = '<p style="color:#777; font-style:italic;">No hay solicitudes pendientes.</p>';
            } else {
                let html = `
                    <table class="user-table">
                        <thead>
                            <tr><th>Nombre</th><th>Usuario</th><th>Fecha</th><th>Acción</th></tr>
                        </thead>
                        <tbody>
                `;
                reqs.forEach((r, idx) => {
                    html += `
                        <tr>
                            <td>${r.nombre}</td>
                            <td>${r.user}</td>
                            <td>${r.fecha}</td>
                            <td>
                                <button onclick="abrirModalAsignacionVisual(${idx})" style="background:var(--success); color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer; font-weight:bold;">Aprobar y Asignar Campo</button>
                                <button onclick="rechazarSolicitud(${idx})" style="background:var(--danger); color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer; font-weight:bold;">Rechazar</button>
                            </td>
                        </tr>
                    `;
                });
                html += `</tbody></table>`;
                reqContainer.innerHTML = html;
            }

            renderizarTablaEstadoCamposAdmin();

            const adminsTbody = document.getElementById('adminsTableBody');
            adminsTbody.innerHTML = '';
            let admins = obtenerAdminsBD();

            admins.forEach((a, aIdx) => {
                let campoTxt = obtenerCamposAsignadosAdmin(a).map(campo => campo.titulo).join(', ') || 'Ninguno asignado';
                let tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${a.nombre}</strong></td>
                    <td>${a.user}</td>
                    <td><span class="badge-role badge-menor">${campoTxt}</span></td>
                    <td><button onclick="eliminarAdminMenor(${aIdx})" style="background:var(--danger); color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer; font-weight:bold;">Remover Admin</button></td>
                `;
                adminsTbody.appendChild(tr);
            });
        }

        function renderizarTablaEstadoCamposAdmin() {
            const container = document.getElementById('adminCamposStatusContainer');
            const camposBD = obtenerCamposBD();
            let opciones = [];

            for (let cat in camposBD) {
                camposBD[cat].forEach((c, cIdx) => {
                    opciones.push({ cat, cIdx, subIdx: null, titulo: `[${cat.toUpperCase()}] ${c.titulo}`, admin: c.adminAsignado });
                    if (c.materias) {
                        c.materias.forEach((m, mIdx) => {
                            opciones.push({ cat, cIdx, subIdx: mIdx, titulo: `[MATERIA DE ${c.titulo}] ${m.titulo}`, admin: m.adminAsignado });
                        });
                    }
                });
            }

            let html = `
                <table class="user-table">
                    <thead>
                        <tr>
                            <th>Campo / Materia</th>
                            <th>Estado de Asignación</th>
                            <th>Administrador a Cargo</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            opciones.forEach(op => {
                let estadoBadge = op.admin ? 
                    `<span style="background:var(--danger); color:white; padding:3px 8px; border-radius:10px; font-size:0.8rem; font-weight:bold;">Ocupado</span>` : 
                    `<span style="background:var(--success); color:white; padding:3px 8px; border-radius:10px; font-size:0.8rem; font-weight:bold;">Libre / Disponible</span>`;
                let adminNombre = op.admin ? `<strong>${op.admin}</strong>` : `<span style="color:#777; font-style:italic;">Admin Principal</span>`;

                html += `
                    <tr>
                        <td>${op.titulo}</td>
                        <td>${estadoBadge}</td>
                        <td>${adminNombre}</td>
                    </tr>
                `;
            });

            html += `</tbody></table>`;
            container.innerHTML = html;
        }   
                                
                                
         function abrirModalAsignacionVisual(reqIdx) {
            solicitudIndexEnProceso = reqIdx;
            let reqs = obtenerSolicitudesBD();
            let req = reqs[reqIdx];

            document.getElementById('asigModalNombre').innerText = req.nombre;

            const camposBD = obtenerCamposBD();
            let libres = [];

            for (let cat in camposBD) {
                camposBD[cat].forEach((c, cIdx) => {
                    if (!c.adminAsignado) {
                        libres.push({ cat, fieldId: c.id, subjectId: null, titulo: `[${cat.toUpperCase()}] ${c.titulo}` });
                    }
                    if (c.materias) {
                        c.materias.forEach((m, mIdx) => {
                            if (!m.adminAsignado) {
                                libres.push({ cat, fieldId: c.id, subjectId: m.id, titulo: `[MATERIA DE ${c.titulo}] ${m.titulo}` });
                            }
                        });
                    }
                });
            }

            const container = document.getElementById('camposLibresRadioContainer');
            container.innerHTML = '';

            if (libres.length === 0) {
                container.innerHTML = '<p style="color:var(--danger); font-weight:bold;">No hay campos libres disponibles en este momento. Todos están ocupados.</p>';
            } else {
                libres.forEach(op => {
                    let label = document.createElement('label');
                    label.className = 'campo-option-card';
                    const input = document.createElement('input');
                    input.type = 'checkbox';
                    input.name = 'campoLibreSel';
                    input.value = JSON.stringify(op);
                    const title = document.createElement('strong');
                    title.textContent = op.titulo;
                    const text = document.createElement('div');
                    text.appendChild(title);
                    label.append(input, text);
                    container.appendChild(label);
                });
                
            }

            document.getElementById('asignarCampoModal').classList.remove('hidden');
        }

        function cerrarModalAsignacion() {
            document.getElementById('asignarCampoModal').classList.add('hidden');
            solicitudIndexEnProceso = null;
        }

        function confirmarAsignacionCampo() {
            const seleccionados = [...document.querySelectorAll('#camposLibresRadioContainer input[name="campoLibreSel"]:checked')];
            if (seleccionados.length === 0) {
                alert('Selecciona entre 1 y 3 campos disponibles.');
                return;
            }

            let reqs = obtenerSolicitudesBD();
            let req = reqs[solicitudIndexEnProceso];
            let camposBD = obtenerCamposBD();
            const camposAsignados = seleccionados.map(control => JSON.parse(control.value));
            const objetivos = [];
            for (const asignacion of camposAsignados) {
                const campo = camposBD[asignacion.cat].find(item => item.id === asignacion.fieldId);
                const objetivo = asignacion.subjectId
                    ? campo?.materias?.find(materia => materia.id === asignacion.subjectId)
                    : campo;
                if (!objetivo || objetivo.adminAsignado) {
                    alert(`El campo "${asignacion.titulo}" ya no está disponible. Actualiza la lista e inténtalo de nuevo.`);
                    return;
                }
                objetivos.push(objetivo);
            }
            for (const objetivo of objetivos) {
                objetivo.adminAsignado = req.user;
            }
            guardarCamposBD(camposBD);

            let nuevoAdmin = {
                nombre: req.nombre,
                user: req.user,
                pass: req.pass,
                campoAsignado: camposAsignados[0],
                camposAsignados
            };

            let adminsBD = obtenerAdminsBD();
            adminsBD.push(nuevoAdmin);
            guardarAdminsBD(adminsBD);

            reqs.splice(solicitudIndexEnProceso, 1);
            guardarSolicitudesBD(reqs);

            cerrarModalAsignacion();
            renderizarSolicitudesYAdmins();
            renderizarBibliotecaCampos();
            alert(`¡Solicitud aprobada! ${req.nombre} recibió ${camposAsignados.length} campo(s).`);
        }

        function rechazarSolicitud(reqIdx) {
            if (confirm('¿Rechazar esta solicitud?')) {
                let reqs = obtenerSolicitudesBD();
                reqs.splice(reqIdx, 1);
                guardarSolicitudesBD(reqs);
                renderizarSolicitudesYAdmins();
            }
        }

        function eliminarAdminMenor(aIdx) {
            if (confirm('¿Remover este Administrador Menor? El campo quedará libre y disponible inmediatamente.')) {
                let admins = obtenerAdminsBD();
                let adm = admins[aIdx];

                const camposBD = obtenerCamposBD();
                obtenerCamposAsignadosAdmin(adm).forEach(asignacion => {
                    const campo = camposBD[asignacion.cat].find(item => item.id === asignacion.fieldId);
                    const target = asignacion.subjectId
                        ? campo?.materias?.find(materia => materia.id === asignacion.subjectId)
                        : campo;
                    if (target?.adminAsignado === adm.user) target.adminAsignado = null;
                });
                guardarCamposBD(camposBD);

                admins.splice(aIdx, 1);
                guardarAdminsBD(admins);
                renderizarSolicitudesYAdmins();
                renderizarBibliotecaCampos();
            }
        }

        function obtenerCamposAsignadosAdmin(admin) {
            const camposBD = obtenerCamposBD();
            const asignaciones = admin.camposAsignados?.length
                ? admin.camposAsignados
                : admin.campoAsignado
                    ? [admin.campoAsignado]
                    : [];

            return asignaciones.flatMap(asignacion => {
                const categoria = camposBD[asignacion.cat];
                if (!categoria) return [];
                const campo = asignacion.fieldId
                    ? categoria.find(item => item.id === asignacion.fieldId)
                    : categoria[asignacion.cIdx];
                if (!campo) return [];

                const materia = asignacion.subjectId
                    ? campo.materias?.find(item => item.id === asignacion.subjectId)
                    : asignacion.subIdx !== null && asignacion.subIdx !== undefined
                        ? campo.materias?.[asignacion.subIdx]
                        : null;
                if ((asignacion.subjectId || asignacion.subIdx !== null && asignacion.subIdx !== undefined) && !materia) {
                    return [];
                }

                return [{
                    cat: asignacion.cat,
                    fieldId: campo.id,
                    subjectId: materia?.id || null,
                    titulo: materia?.titulo || campo.titulo
                }];
            });
        }

        function mostrarSelectorCamposAdmin() {
            document.getElementById('campoViewSection').classList.add('hidden');
            document.getElementById('bibliotecaSection').classList.add('hidden');
            actualizarVisibilidadPanelesGenerales(false);
            document.getElementById('adminFieldSelector').classList.remove('hidden');
            actualizarEnlaceBiblioteca();

            const grid = document.getElementById('adminAssignedFieldsGrid');
            grid.innerHTML = '';
            const asignaciones = obtenerCamposAsignadosAdmin(adminMenorDatos);
            if (asignaciones.length === 0) {
                grid.innerHTML = '<p>No tienes campos asignados. Contacta al administrador principal.</p>';
                return;
            }

            asignaciones.forEach((asignacion, index) => {
                const card = document.createElement('button');
                card.type = 'button';
                card.className = 'info-card';
                const title = document.createElement('h3');
                title.textContent = asignacion.titulo;
                const action = document.createElement('span');
                action.textContent = 'Entrar al campo →';
                card.append(title, action);
                card.addEventListener('click', () => abrirCampoAsignado(index));
                grid.appendChild(card);
            });
        }

        function abrirCampoAsignado(asignacionIndex) {
            const asignacion = obtenerCamposAsignadosAdmin(adminMenorDatos)[asignacionIndex];
            if (!asignacion) {
                mostrarSelectorCamposAdmin();
                return;
            }

            const camposBD = obtenerCamposBD();
            const indiceCampo = camposBD[asignacion.cat].findIndex(campo => campo.id === asignacion.fieldId);
            if (indiceCampo === -1) {
                mostrarSelectorCamposAdmin();
                return;
            }

            pestanaActualBiblioteca = asignacion.cat;
            const materiaIndex = asignacion.subjectId
                ? camposBD[asignacion.cat][indiceCampo].materias.findIndex(materia => materia.id === asignacion.subjectId)
                : null;
            if (asignacion.subjectId && materiaIndex === -1) {
                mostrarSelectorCamposAdmin();
                return;
            }

            document.getElementById('adminFieldSelector').classList.add('hidden');
            abrirCampo(indiceCampo, materiaIndex);
        }

        function cambiarPestanaBiblioteca(categoria) {
            pestanaActualBiblioteca = categoria;
            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            event.target.classList.add('active');
            renderizarBibliotecaCampos();
        }

        function estudiantePuedeVerCampo(campoObj) {
            if (rolSesionActiva !== 'estudiante') return true;
            if (pestanaActualBiblioteca !== 'grados') return true;
            return campoObj.titulo.includes(usuarioActual.grado);
        }

        function renderizarBibliotecaCampos() {
            const container = document.getElementById('infoGridContainer');
            const camposBD = obtenerCamposBD();
            const lista = camposBD[pestanaActualBiblioteca] || [];
            container.innerHTML = '';

            lista.forEach((campo, index) => {
                if (!estudiantePuedeVerCampo(campo)) return;

                const card = document.createElement('div');
                card.className = 'info-card';
                
                let countQuiz = campo.cuestionarios ? campo.cuestionarios.length : 0;
                let countArt = campo.articulos ? campo.articulos.length : 0;
                let countWeb = campo.sitiosWeb ? campo.sitiosWeb.length : 0;
                let subCount = campo.materias ? campo.materias.length : 0;

                let extraInfo = pestanaActualBiblioteca === 'grados' ? 
                    `📚 ${subCount} Materias de Grado` : 
                    `📝 ${countQuiz} Cuestionarios | 📖 ${countArt} Artículos | 🔗 ${countWeb} Enlaces`;

                let adminInfo = campo.adminAsignado ? `<br><small style="color:var(--admin-color);">👤 Admin: ${campo.adminAsignado}</small>` : `<br><small style="color:var(--success);">👑 Admin Principal</small>`;

                let html = `
                    <h3>${campo.titulo}</h3>
                    <p>${campo.resumen}</p>
                    <small style="color:var(--dark-blue); font-weight:bold;">Entrar al Campo →</small>
                    <div style="margin-top: 10px; font-size:0.8rem; color:#555;">${extraInfo} ${adminInfo}</div>
                `;

                if (rolSesionActiva === 'superadmin') {
                    html += `
                        <div class="card-admin-actions" onclick="event.stopPropagation()">
                            <button class="btn-card-edit" onclick="prepararEdicionCampo(${index})">Editar</button>
                            <button class="btn-card-delete" onclick="eliminarCampo(${index})">Eliminar Campo</button>
                        </div>
                    `;
                }

                card.innerHTML = html;
                card.onclick = () => abrirCampo(index, null);
                container.appendChild(card);
            });
        }

        function esAdminConPermisoDeEdicion(campoObj) {
            if (rolSesionActiva === 'superadmin') {
                return !campoObj.adminAsignado; // Si asignó un admin menor, pierde el permiso de edición directa de contenido
            }
            if (rolSesionActiva === 'admin_menor') {
                return adminMenorDatos && campoObj.adminAsignado === adminMenorDatos.user;
            }
            return false;
        }

        function actualizarVisibilidadPanelesGenerales(visible) {
            const esAdminPrincipal = rolSesionActiva === 'superadmin';
            const esAdminMenor = rolSesionActiva === 'admin_menor';
            const esEstudiante = rolSesionActiva === 'estudiante';

            document.getElementById('adminDashboardTitle').classList.toggle('hidden', !visible || !esAdminPrincipal);
            document.getElementById('adminPanelSection').classList.toggle('hidden', !visible || !esAdminPrincipal);
            document.getElementById('superAdminRequestsSection').classList.toggle('hidden', !visible || !esAdminPrincipal);
            document.getElementById('adminUsersSection').classList.toggle('hidden', !esAdminMenor && (!visible || !esAdminPrincipal));
            document.getElementById('studentProgressBox').classList.toggle('hidden', !visible || !esEstudiante);
        }

        function abrirCampo(index, subIndex) {
            campoActualIndex = index;
            subMateriaActualIndex = subIndex;

            const camposBD = obtenerCamposBD();
            let campoObj = camposBD[pestanaActualBiblioteca][index];
            const esContenedorGrado = pestanaActualBiblioteca === 'grados' && subIndex === null;

            let objetivo = campoObj;
            if (pestanaActualBiblioteca === 'grados' && subIndex !== null) {
                objetivo = campoObj.materias[subIndex];
                document.getElementById('subMateriasContainer').classList.add('hidden');
            } else if (pestanaActualBiblioteca === 'grados' && subIndex === null) {
                document.getElementById('subMateriasContainer').classList.remove('hidden');
                renderizarSubMateriasGrado(campoObj);
            } else {
                document.getElementById('subMateriasContainer').classList.add('hidden');
            }

            document.getElementById('campoTitle').innerText = objetivo.titulo;
            document.getElementById('campoBodyText').innerText = objetivo.contenido;
            document.getElementById('campoBodyText').classList.toggle('hidden', esContenedorGrado);
            document.getElementById('campoProgressBadge').classList.toggle('hidden', esContenedorGrado);
            document.getElementById('campoContentSections').classList.toggle('hidden', esContenedorGrado);

            let tieneEdicion = esAdminConPermisoDeEdicion(objetivo);

            document.getElementById('adminGradeTools').classList.toggle('hidden', !esContenedorGrado || !tieneEdicion);
            if (tieneEdicion && !esContenedorGrado) {
                document.getElementById('adminCampoTools').classList.remove('hidden');
                document.getElementById('contentInput').value = objetivo.contenido || '';
            } else {
                document.getElementById('adminCampoTools').classList.add('hidden');
            }

            if (!esContenedorGrado) {
                renderizarElementosContenido(objetivo, tieneEdicion);
                actualizarPorcentajeProgresoCampo(objetivo);
            }

            document.getElementById('bibliotecaSection').classList.add('hidden');
            actualizarVisibilidadPanelesGenerales(false);
            document.getElementById('campoViewSection').classList.remove('hidden');
            actualizarEnlaceBiblioteca();
        }

        function renderizarSubMateriasGrado(campoGrado) {
            const grid = document.getElementById('subMateriasGrid');
            grid.innerHTML = '';
            if (!campoGrado.materias || campoGrado.materias.length === 0) {
                grid.innerHTML = '<p style="color:#777; font-style:italic;">No hay materias creadas en este año escolar.</p>';
                return;
            }

            campoGrado.materias.forEach((mat, mIdx) => {
                const card = document.createElement('div');
                card.className = 'info-card';
                let admTxt = mat.adminAsignado ? `<br><small style="color:var(--admin-color);">👤 Admin: ${mat.adminAsignado}</small>` : '';

                card.innerHTML = `
                    <h3>${mat.titulo}</h3>
                    <p>${mat.resumen}</p>
                    <small style="color:var(--dark-blue); font-weight:bold;">Entrar a Materia →</small>
                    ${admTxt}
                `;

                if (rolSesionActiva === 'superadmin' && !mat.adminAsignado) {
                    card.innerHTML += `
                        <div class="card-admin-actions" onclick="event.stopPropagation()">
                            <button class="btn-card-delete" onclick="eliminarSubMateria(${mIdx})">Eliminar Materia</button>
                        </div>
                    `;
                }
                card.onclick = () => abrirCampo(campoActualIndex, mIdx);
                grid.appendChild(card);
            });
        }

        function insertarTextoArticulo(contenedor, texto) {
            const partes = texto.split(/\*\*([^*]+)\*\*/g);
            partes.forEach((parte, indice) => {
                if (indice % 2 === 1) {
                    const negrita = document.createElement('strong');
                    negrita.textContent = parte;
                    contenedor.appendChild(negrita);
                } else {
                    contenedor.appendChild(document.createTextNode(parte));
                }
            });
        }

        function renderizarElementosContenido(obj, puedeEditar) {
            const qContainer = document.getElementById('campoQuizzesContainer');
            const cuestionarios = Array.isArray(obj.cuestionarios) ? obj.cuestionarios : [];
            document.getElementById('quizLimitStatus').textContent =
                `${cuestionarios.length} de ${MAX_QUIZZES_PER_CONTENT} cuestionarios`;
            document.getElementById('addQuizButton').disabled =
                !puedeEditar || cuestionarios.length >= MAX_QUIZZES_PER_CONTENT;
            qContainer.innerHTML = '';
            if (cuestionarios.length === 0) {
                qContainer.innerHTML = '<p style="color:#888; font-style:italic;">No hay cuestionarios en este campo.</p>';
            } else {
                cuestionarios.forEach((q, qIdx) => {
                    let key = generarClaveActividad('quiz', qIdx);
                    let resuelto = esActividadCompletada(key);
                    let avisoIntento = '';
                    if (q.intentos && q.intentos !== 'indefinidos') {
                        avisoIntento = `<div style="background:#fff3cd; color:#856404; padding:5px 10px; border-radius:4px; font-size:0.85rem; margin-bottom:8px;">⚠️ Límite: <strong>${q.intentos} intento(s)</strong>.</div>`;
                    }

                    let div = document.createElement('div');
                    div.className = 'quiz-card';
                    div.innerHTML = `
                        ${puedeEditar ? `<button class="btn-card-delete" style="position:absolute; top:15px; right:15px;" onclick="eliminarActividad('quiz', ${qIdx})">Eliminar</button>` : ''}
                        <strong>Cuestionario ${qIdx + 1}: ${q.pregunta}</strong>
                        ${avisoIntento}
                        <div style="margin-top:10px; display:flex; flex-direction:column; gap:6px;">
                            <label><input type="radio" name="${key}" value="1" ${resuelto ? 'disabled' : ''}> ${q.opcion1}</label>
                            <label><input type="radio" name="${key}" value="2" ${resuelto ? 'disabled' : ''}> ${q.opcion2}</label>
                            <label><input type="radio" name="${key}" value="3" ${resuelto ? 'disabled' : ''}> ${q.opcion3}</label>
                        </div>
                        <div id="feedback_${key}" class="feedback-msg"></div>
                        ${!resuelto && rolSesionActiva === 'estudiante' ? `<button class="btn-check-done" onclick="verificarQuiz('${key}', '${q.correcta}', '${q.intentos || "indefinidos"}')">Enviar Respuesta</button>` : ''}
                        ${resuelto ? '<div style="margin-top:8px; color:var(--success); font-weight:bold;">✓ Cuestionario Aprobado</div>' : ''}
                    `;
                    qContainer.appendChild(div);
                });
            }

            const aContainer = document.getElementById('campoArticlesContainer');
            const articulos = Array.isArray(obj.articulos) ? obj.articulos : [];
            document.getElementById('articleLimitStatus').textContent =
                `${articulos.length} de ${MAX_ARTICLES_PER_CONTENT} artículos`;
            document.getElementById('publishArticleButton').disabled =
                !puedeEditar || articulos.length >= MAX_ARTICLES_PER_CONTENT;
            aContainer.innerHTML = '';
            if (articulos.length === 0) {
                aContainer.innerHTML = '<p style="color:#888; font-style:italic;">No hay artículos publicados.</p>';
            } else {
                articulos.forEach((art, aIdx) => {
                    let key = generarClaveActividad('art', aIdx);
                    let resuelto = esActividadCompletada(key);
                    let div = document.createElement('div');
                    div.className = 'article-card';
                    const texto = art.textoContinuo || '';
                    const tarjeta = document.createElement('button');
                    tarjeta.type = 'button';
                    tarjeta.className = 'article-card-toggle';
                    tarjeta.setAttribute('aria-expanded', 'false');
                    const titulo = document.createElement('span');
                    titulo.className = 'article-title-main';
                    titulo.textContent = art.tituloMain || 'Artículo';
                    const resumen = document.createElement('span');
                    resumen.className = 'article-preview';
                    resumen.textContent = texto.slice(0, 220) + (texto.length > 220 ? '…' : '');
                    const accion = document.createElement('span');
                    accion.className = 'article-open-label';
                    accion.textContent = 'Leer artículo completo →';
                    tarjeta.append(titulo, resumen, accion);

                    const cuerpo = document.createElement('div');
                    cuerpo.className = 'article-body-content hidden';
                    insertarTextoArticulo(cuerpo, texto);
                    tarjeta.addEventListener('click', () => {
                        const abierto = tarjeta.getAttribute('aria-expanded') === 'true';
                        tarjeta.setAttribute('aria-expanded', String(!abierto));
                        cuerpo.classList.toggle('hidden', abierto);
                        accion.textContent = abierto ? 'Leer artículo completo →' : 'Cerrar artículo ↑';
                    });
                    div.appendChild(tarjeta);
                    div.appendChild(cuerpo);

                    if (puedeEditar) {
                        const deleteButton = document.createElement('button');
                        deleteButton.type = 'button';
                        deleteButton.className = 'btn-card-delete article-delete';
                        deleteButton.textContent = 'Eliminar';
                        deleteButton.addEventListener('click', () => eliminarActividad('art', aIdx));
                        div.appendChild(deleteButton);
                    }
                    if (!resuelto && rolSesionActiva === 'estudiante') {
                        const readButton = document.createElement('button');
                        readButton.type = 'button';
                        readButton.className = 'btn-check-done';
                        readButton.textContent = 'Marcar Artículo como Leído ✅';
                        readButton.addEventListener('click', () => marcarCompletado(key));
                        div.appendChild(readButton);
                    } else if (resuelto) {
                        const status = document.createElement('div');
                        status.className = 'article-read-status';
                        status.textContent = '✓ Artículo Leído';
                        div.appendChild(status);
                    }
                    aContainer.appendChild(div);
                });
            }

            const sitiosWeb = Array.isArray(obj.sitiosWeb) ? obj.sitiosWeb : [];
            const websitesSection = document.getElementById('campoWebsitesSection');
            const websitesContainer = document.getElementById('campoWebsitesContainer');
            websitesContainer.innerHTML = '';
            websitesSection.classList.toggle('hidden', sitiosWeb.length === 0);
            const websiteLimitStatus = document.getElementById('websiteLimitStatus');
            websiteLimitStatus.textContent = `${sitiosWeb.length} de ${MAX_LINKS_PER_CONTENT} enlaces usados`;
            document.getElementById('addWebsiteButton').disabled =
                !puedeEditar || sitiosWeb.length >= MAX_LINKS_PER_CONTENT;

            sitiosWeb.forEach((sitio, index) => {
                let url;
                try {
                    url = new URL(sitio.url);
                } catch {
                    return;
                }
                if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;

                const card = document.createElement('div');
                card.className = 'link-card';
                if (puedeEditar) {
                    const removeButton = document.createElement('button');
                    removeButton.className = 'btn-card-delete';
                    removeButton.textContent = 'Eliminar';
                    removeButton.addEventListener('click', () => eliminarActividad('web', index));
                    card.appendChild(removeButton);
                }

                const link = document.createElement('a');
                link.href = url.href;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = `🔗 ${sitio.titulo}`;
                card.appendChild(link);
                websitesContainer.appendChild(card);
            });
        }

        function generarClaveActividad(tipo, idx) {
            return `${pestanaActualBiblioteca}_${campoActualIndex}_${subMateriaActualIndex !== null ? subMateriaActualIndex : 'main'}_${tipo}_${idx}`;
        }

        function verificarQuiz(key, correcta, limiteIntentos) {
            const radios = document.getElementsByName(key);
            let seleccion = null;
            for (let r of radios) { if (r.checked) seleccion = r.value; }

            const feedbackDiv = document.getElementById(`feedback_${key}`);

            if (!seleccion) {
                feedbackDiv.className = "feedback-msg feedback-error";
                feedbackDiv.innerText = "Por favor, selecciona una opción.";
                return;
            }

            if (!usuarioActual.intentosQuizzes) usuarioActual.intentosQuizzes = {};
            if (!usuarioActual.intentosQuizzes[key]) usuarioActual.intentosQuizzes[key] = 0;

            if (limiteIntentos !== 'indefinidos') {
                let maxInt = parseInt(limiteIntentos);
                usuarioActual.intentosQuizzes[key]++;
                if (usuarioActual.intentosQuizzes[key] > maxInt) {
                    feedbackDiv.className = "feedback-msg feedback-error";
                    feedbackDiv.innerText = "Has superado el número máximo de intentos permitidos para este cuestionario.";
                    return;
                }
            }

            if (seleccion === correcta) {
                feedbackDiv.className = "feedback-msg feedback-success";
                feedbackDiv.innerText = "¡Respuesta Correcta!";
                marcarCompletado(key);
            } else {
                feedbackDiv.className = "feedback-msg feedback-error";
                feedbackDiv.innerText = "Respuesta incorrecta. Inténtalo de nuevo.";
            }
        }

        function esActividadCompletada(key) {
            if (!usuarioActual || !usuarioActual.progresoCompletado) return false;
            return !!usuarioActual.progresoCompletado[key];
        }

        function marcarCompletado(key) {
            if (!usuarioActual) return;
            if (!usuarioActual.progresoCompletado) usuarioActual.progresoCompletado = {};

            usuarioActual.progresoCompletado[key] = true;

            let usuarios = obtenerUsuariosBD();
            let idx = usuarios.findIndex(u => normalizarTexto(u.nombre) === normalizarTexto(usuarioActual.nombre));
            if (idx !== -1) {
                usuarios[idx] = usuarioActual;
                guardarUsuariosBD(usuarios);
            }

            const camposBD = obtenerCamposBD();
            let campoObj = camposBD[pestanaActualBiblioteca][campoActualIndex];
            let objetivo = subMateriaActualIndex !== null ? campoObj.materias[subMateriaActualIndex] : campoObj;

            actualizarPorcentajeProgresoCampo(objetivo);
            actualizarProgresoEstudianteGlobal();
            renderizarElementosContenido(objetivo, false);
        }

        function calcularTotalActividadesObjeto(obj) {
            let total = 0;
            total += (obj.cuestionarios ? obj.cuestionarios.length : 0);
            total += (obj.articulos ? obj.articulos.length : 0);
            return total;
        }

        function actualizarPorcentajeProgresoCampo(obj) {
            let total = calcularTotalActividadesObjeto(obj);
            let completadas = 0;

            if (usuarioActual && usuarioActual.progresoCompletado) {
                for (let k in usuarioActual.progresoCompletado) {
                    if (k.includes(`${pestanaActualBiblioteca}_${campoActualIndex}_${subMateriaActualIndex !== null ? subMateriaActualIndex : 'main'}`)) {
                        if (usuarioActual.progresoCompletado[k]) completadas++;
                    }
                }
            }

            let pct = total === 0 ? 0 : Math.round((completadas / total) * 100);
            if (pct > 100) pct = 100;
            document.getElementById('campoProgressBadge').innerText = `Progreso del Campo: ${pct}%`;
        }

        function actualizarProgresoEstudianteGlobal() {
            if (!usuarioActual) return;
            const camposBD = obtenerCamposBD();
            let totalGeneral = 0;

            for (let cat in camposBD) {
                camposBD[cat].forEach(c => {
                    totalGeneral += calcularTotalActividadesObjeto(c);
                    if (c.materias) {
                        c.materias.forEach(m => totalGeneral += calcularTotalActividadesObjeto(m));
                    }
                });
            }

            let completadasGlobal = 0;
            if (usuarioActual.progresoCompletado) {
                for (let k in usuarioActual.progresoCompletado) {
                    if (usuarioActual.progresoCompletado[k]) completadasGlobal++;
                }
            }

            let pctGlobal = totalGeneral === 0 ? 0 : Math.round((completadasGlobal / totalGeneral) * 100);
            if (pctGlobal > 100) pctGlobal = 100;

            document.getElementById('progressBar').style.width = pctGlobal + '%';
            document.getElementById('progressText').innerText = `Tu Progreso General: ${pctGlobal}% Completado (${completadasGlobal} de ${totalGeneral} actividades)`;
        }

        function guardarCampo() {
            const editIndex = parseInt(document.getElementById('editIndex').value);
            const cat = document.getElementById('cardCategoryInput').value;
            const titulo = document.getElementById('cardTitleInput').value.trim();
            const resumen = document.getElementById('cardResumenInput').value.trim();
            const contenido = cat === 'grados' ? '' : document.getElementById('cardContentInput').value.trim();

            if (!titulo || !resumen || (cat !== 'grados' && !contenido)) {
                alert(cat === 'grados'
                    ? 'Ingresa el título y el resumen del grado.'
                    : 'Completa todos los campos obligatorios.');
                return;
            }

            let camposBD = obtenerCamposBD();
            if (!camposBD[cat]) camposBD[cat] = [];

            if (editIndex === -1) {
                const limiteCategoria = cat === 'grados' ? MAX_GRADE_FIELDS : MAX_FIELDS_PER_CATEGORY;
                if (camposBD[cat].length >= limiteCategoria) {
                    alert(`Esta categoría permite un máximo de ${limiteCategoria} campos.`);
                    return;
                }
                if (cat !== 'grados' && contarCamposYMaterias(camposBD) >= MAX_LEARNING_CONTENTS) {
                    alert(`La plataforma permite un máximo total de ${MAX_LEARNING_CONTENTS} campos y materias.`);
                    return;
                }
                let nuevoCampo = { id: crearIdContenido(), titulo, resumen, contenido, adminAsignado: null, cuestionarios: [], articulos: [], sitiosWeb: [] };
                if (cat === 'grados') nuevoCampo.materias = [];
                camposBD[cat].push(nuevoCampo);
            } else {
                camposBD[pestanaActualBiblioteca][editIndex].titulo = titulo;
                camposBD[pestanaActualBiblioteca][editIndex].resumen = resumen;
                camposBD[pestanaActualBiblioteca][editIndex].contenido = contenido;
            }

            guardarCamposBD(camposBD);
            cancelarEdicion();
            renderizarBibliotecaCampos();
            alert('Campo guardado exitosamente.');
        }

        function prepararEdicionCampo(index) {
            const camposBD = obtenerCamposBD();
            const campo = camposBD[pestanaActualBiblioteca][index];

            document.getElementById('cardCategoryInput').value = pestanaActualBiblioteca;
            document.getElementById('cardTitleInput').value = campo.titulo;
            document.getElementById('cardResumenInput').value = campo.resumen;
            document.getElementById('cardContentInput').value = campo.contenido;
            document.getElementById('editIndex').value = index;
            document.getElementById('adminFormTitle').innerText = "Editando Campo: " + campo.titulo;
            actualizarFormularioCampo();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function actualizarFormularioCampo() {
            const esGrado = document.getElementById('cardCategoryInput').value === 'grados';
            document.getElementById('cardContentGroup').classList.toggle('hidden', esGrado);
        }

        function eliminarCampo(index) {
            if (confirm('¿Estás seguro de eliminar este campo completo y todo su contenido?')) {
                let camposBD = obtenerCamposBD();
                camposBD[pestanaActualBiblioteca].splice(index, 1);
                guardarCamposBD(camposBD);
                renderizarBibliotecaCampos();
            }
        }

        function cancelarEdicion() {
            document.getElementById('cardTitleInput').value = '';
            document.getElementById('cardResumenInput').value = '';
            document.getElementById('cardContentInput').value = '';
            document.getElementById('editIndex').value = '-1';
            document.getElementById('adminFormTitle').innerText = "Crear / Editar Campo Didáctico";
            actualizarFormularioCampo();
        }

        function agregarSubMateria() {
            const titulo = document.getElementById('subMatTitle').value.trim();
            const resumen = document.getElementById('subMatResumen').value.trim();

            if (!titulo || !resumen) {
                alert('Ingresa el nombre y el resumen de la materia.');
                return;
            }

            let camposBD = obtenerCamposBD();
            let gradoObj = camposBD.grados[campoActualIndex];
            if (!gradoObj.materias) gradoObj.materias = [];
            if (gradoObj.materias.length >= MAX_SUBJECTS_PER_GRADE) {
                alert(`Cada campo de grado permite un máximo de ${MAX_SUBJECTS_PER_GRADE} materias.`);
                return;
            }
            if (contarCamposYMaterias(camposBD) >= MAX_LEARNING_CONTENTS) {
                alert(`La plataforma permite un máximo total de ${MAX_LEARNING_CONTENTS} campos y materias.`);
                return;
            }

            gradoObj.materias.push({
                id: crearIdContenido(),
                titulo,
                resumen,
                contenido: '',
                adminAsignado: rolSesionActiva === 'admin_menor' ? adminMenorDatos.user : null,
                cuestionarios: [],
                articulos: [],
                sitiosWeb: []
            });
            guardarCamposBD(camposBD);

            document.getElementById('subMatTitle').value = '';
            document.getElementById('subMatResumen').value = '';

            abrirCampo(campoActualIndex, null);
            alert('Materia agregada al año escolar.');
        }

        function guardarContenidoTeorico() {
            const contenido = document.getElementById('contentInput').value.trim();
            if (!contenido) {
                alert('Escribe el contenido teórico de este campo o materia.');
                return;
            }

            const camposBD = obtenerCamposBD();
            const campo = camposBD[pestanaActualBiblioteca][campoActualIndex];
            const objetivo = subMateriaActualIndex !== null ? campo.materias[subMateriaActualIndex] : campo;
            objetivo.contenido = contenido;
            guardarCamposBD(camposBD);
            document.getElementById('campoBodyText').innerText = contenido;
            alert('Contenido teórico guardado.');
        }

        function eliminarSubMateria(mIdx) {
            if (confirm('¿Eliminar esta materia del grado?')) {
                let camposBD = obtenerCamposBD();
                camposBD.grados[campoActualIndex].materias.splice(mIdx, 1);
                guardarCamposBD(camposBD);
                abrirCampo(campoActualIndex, null);
            }
        }

        function publicarArticuloEstructurado() {
            const tituloMain = document.getElementById('artInputTitleMain').value.trim();
            const textoContinuo = document.getElementById('artInputTextoContinuo').value.trim();

            if (!tituloMain || !textoContinuo) {
                alert('Ingresa el título y el cuerpo del artículo.');
                return;
            }
            const totalPalabras = contarPalabras(textoContinuo);
            if (totalPalabras > MAX_ARTICLE_WORDS) {
                alert(`El artículo tiene ${totalPalabras} palabras. El máximo permitido es ${MAX_ARTICLE_WORDS}.`);
                return;
            }

            let camposBD = obtenerCamposBD();
            let campoObj = camposBD[pestanaActualBiblioteca][campoActualIndex];
            let objetivo = subMateriaActualIndex !== null ? campoObj.materias[subMateriaActualIndex] : campoObj;

            if (!objetivo.articulos) objetivo.articulos = [];
            if (objetivo.articulos.length >= MAX_ARTICLES_PER_CONTENT) {
                alert(`Cada campo o materia permite un máximo de ${MAX_ARTICLES_PER_CONTENT} artículos.`);
                return;
            }
            objetivo.articulos.push({ tituloMain, textoContinuo });
            guardarCamposBD(camposBD);

            document.getElementById('artInputTitleMain').value = '';
            document.getElementById('artInputTextoContinuo').value = '';
            actualizarConteoPalabrasArticulo();

            renderizarElementosContenido(objetivo, true);
            alert('Artículo publicado con éxito.');
        }

        function agregarSitioWebACampo() {
            const titulo = document.getElementById('websiteTitleInput').value.trim();
            const entradaUrl = document.getElementById('websiteUrlInput').value.trim();
            let url;

            try {
                url = new URL(entradaUrl);
            } catch {
                alert('Ingresa una dirección web válida que comience con https:// o http://.');
                return;
            }

            if (!titulo || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
                alert('Ingresa un nombre y un enlace web válido (http o https).');
                return;
            }

            const camposBD = obtenerCamposBD();
            const campo = camposBD[pestanaActualBiblioteca][campoActualIndex];
            const objetivo = subMateriaActualIndex !== null ? campo.materias[subMateriaActualIndex] : campo;
            if (!Array.isArray(objetivo.sitiosWeb)) objetivo.sitiosWeb = [];
            if (objetivo.sitiosWeb.length >= MAX_LINKS_PER_CONTENT) {
                alert(`Cada campo o materia permite un máximo de ${MAX_LINKS_PER_CONTENT} enlaces.`);
                return;
            }
            objetivo.sitiosWeb.push({ titulo, url: url.href });
            guardarCamposBD(camposBD);
            document.getElementById('websiteTitleInput').value = '';
            document.getElementById('websiteUrlInput').value = '';
            renderizarElementosContenido(objetivo, true);
        }

        function agregarCuestionarioACampo() {
            const pregunta = document.getElementById('qInputPregunta').value.trim();
            const opcion1 = document.getElementById('qInputOpt1').value.trim();
            const opcion2 = document.getElementById('qInputOpt2').value.trim();
            const opcion3 = document.getElementById('qInputOpt3').value.trim();
            const correcta = document.getElementById('qInputCorrect').value;
            const intentos = document.getElementById('qInputIntentos').value;

            if (!pregunta || !opcion1 || !opcion2 || !opcion3) {
                alert('Completa la pregunta y las 3 opciones de respuesta.');
                return;
            }
            if (pregunta.length > MAX_QUIZ_QUESTION_CHARS
                || [opcion1, opcion2, opcion3].some(opcion => opcion.length > MAX_QUIZ_OPTION_CHARS)) {
                alert(`La pregunta admite hasta ${MAX_QUIZ_QUESTION_CHARS} caracteres y cada opción hasta ${MAX_QUIZ_OPTION_CHARS}.`);
                return;
            }

            let camposBD = obtenerCamposBD();
            let campoObj = camposBD[pestanaActualBiblioteca][campoActualIndex];
            let objetivo = subMateriaActualIndex !== null ? campoObj.materias[subMateriaActualIndex] : campoObj;

            if (!objetivo.cuestionarios) objetivo.cuestionarios = [];
            if (objetivo.cuestionarios.length >= MAX_QUIZZES_PER_CONTENT) {
                alert(`Cada campo o materia permite un máximo de ${MAX_QUIZZES_PER_CONTENT} cuestionarios.`);
                return;
            }
            objetivo.cuestionarios.push({ pregunta, opcion1, opcion2, opcion3, correcta, intentos });
            guardarCamposBD(camposBD);

            document.getElementById('qInputPregunta').value = '';
            document.getElementById('qInputOpt1').value = '';
            document.getElementById('qInputOpt2').value = '';
            document.getElementById('qInputOpt3').value = '';
            actualizarConteosCuestionario();

            renderizarElementosContenido(objetivo, true);
            alert('Cuestionario guardado con éxito.');
        }

        function eliminarActividad(tipo, idx) {
            if (confirm('¿Estás seguro de eliminar este elemento?')) {
                let camposBD = obtenerCamposBD();
                let campoObj = camposBD[pestanaActualBiblioteca][campoActualIndex];
                let objetivo = subMateriaActualIndex !== null ? campoObj.materias[subMateriaActualIndex] : campoObj;

                if (tipo === 'quiz') objetivo.cuestionarios.splice(idx, 1);
                if (tipo === 'art') objetivo.articulos.splice(idx, 1);
                if (tipo === 'web') objetivo.sitiosWeb.splice(idx, 1);

                guardarCamposBD(camposBD);
                renderizarElementosContenido(objetivo, true);
            }
        }

        function obtenerTotalActividadesGeneral() {
            const camposBD = obtenerCamposBD();
            let total = 0;
            for (const lista of Object.values(camposBD)) {
                lista.forEach(campo => {
                    total += calcularTotalActividadesObjeto(campo);
                    if (campo.materias) {
                        campo.materias.forEach(materia => {
                            total += calcularTotalActividadesObjeto(materia);
                        });
                    }
                });
            }
            return total;
        }

        function calcularProgresoAdmin(estudiante, totalActividades) {
            const scope = opcionesProgresoAdmin.find(opcion =>
                opcion.key === document.getElementById('userProgressScope').value
            );
            if (scope) {
                const campos = obtenerCamposBD()[scope.cat] || [];
                const campoIndex = campos.findIndex(campo => campo.id === scope.fieldId);
                const campo = campos[campoIndex];
                const subIndex = scope.subjectId
                    ? campo?.materias?.findIndex(materia => materia.id === scope.subjectId)
                    : null;
                const objetivo = scope.subjectId
                    ? subIndex >= 0 ? campo.materias[subIndex] : null
                    : campo;
                const totalCampo = objetivo ? calcularTotalActividadesObjeto(objetivo) : 0;
                const prefijo = objetivo
                    ? `${scope.cat}_${campoIndex}_${subIndex === null ? 'main' : subIndex}_`
                    : '';
                const completadas = Object.entries(estudiante.progresoCompletado || {})
                    .filter(([clave, completada]) => completada && prefijo && clave.startsWith(prefijo))
                    .length;
                return {
                    completadas,
                    porcentaje: totalCampo === 0
                        ? 0
                        : Math.min(100, Math.round((completadas / totalCampo) * 100)),
                    totalActividades: totalCampo
                };
            }

            const completadas = Object.values(estudiante.progresoCompletado || {})
                .filter(Boolean).length;
            return {
                completadas,
                porcentaje: totalActividades === 0
                    ? 0
                    : Math.min(100, Math.round((completadas / totalActividades) * 100)),
                totalActividades
            };
        }

        function actualizarOpcionesProgresoAdmin() {
            const selector = document.getElementById('userProgressScope');
            const seleccionado = selector.value;
            const camposBD = obtenerCamposBD();
            opcionesProgresoAdmin = [];

            if (rolSesionActiva === 'superadmin') {
                for (const [cat, campos] of Object.entries(camposBD)) {
                    campos.forEach(campo => {
                        if (!campo.adminAsignado) {
                            opcionesProgresoAdmin.push({
                                cat, fieldId: campo.id, subjectId: null,
                                titulo: `Campo: ${campo.titulo}`,
                                key: `${cat}|${campo.id}|`
                            });
                        }
                        (campo.materias || []).forEach(materia => {
                            if (!materia.adminAsignado) {
                                opcionesProgresoAdmin.push({
                                    cat, fieldId: campo.id, subjectId: materia.id,
                                    titulo: `Materia: ${materia.titulo}`,
                                    key: `${cat}|${campo.id}|${materia.id}`
                                });
                            }
                        });
                    });
                }
            } else if (rolSesionActiva === 'admin_menor') {
                opcionesProgresoAdmin = obtenerCamposAsignadosAdmin(adminMenorDatos)
                    .filter(asignacion => {
                        const campo = (camposBD[asignacion.cat] || [])
                            .find(item => item.id === asignacion.fieldId);
                        const objetivo = asignacion.subjectId
                            ? campo?.materias?.find(item => item.id === asignacion.subjectId)
                            : campo;
                        return objetivo?.adminAsignado === adminMenorDatos.user;
                    })
                    .map(asignacion => ({
                        ...asignacion,
                        key: `${asignacion.cat}|${asignacion.fieldId}|${asignacion.subjectId || ''}`
                    }));
            }

            selector.replaceChildren();
            if (rolSesionActiva === 'superadmin') {
                selector.add(new Option('Progreso general', 'general'));
                opcionesProgresoAdmin.forEach(opcion => selector.add(new Option(opcion.titulo, opcion.key)));
            } else if (opcionesProgresoAdmin.length) {
                opcionesProgresoAdmin.forEach(opcion => selector.add(new Option(opcion.titulo, opcion.key)));
            } else {
                const opcion = new Option('Sin campos asignados', '');
                opcion.disabled = true;
                selector.add(opcion);
            }

            if ([...selector.options].some(option => option.value === seleccionado)) {
                selector.value = seleccionado;
            } else if (rolSesionActiva === 'superadmin') {
                selector.value = 'general';
            }

            const scope = opcionesProgresoAdmin.find(opcion => opcion.key === selector.value);
            const resetButton = document.getElementById('resetFieldProgressButton');
            resetButton.hidden = !['superadmin', 'admin_menor'].includes(rolSesionActiva)
                || !scope;
            resetButton.textContent = rolSesionActiva === 'admin_menor'
                ? 'Reiniciar progreso de mi campo'
                : 'Reiniciar progreso del campo';
            document.getElementById('userProgressHeading').textContent = selector.value === 'general'
                ? 'Progreso General'
                : scope ? `Progreso: ${scope.titulo.replace(/^(Campo|Materia): /, '')}` : 'Progreso del campo';
            document.getElementById('studentTableSubtext').textContent = rolSesionActiva === 'admin_menor'
                ? 'Progreso de los estudiantes en tus campos o materias asignados. Puedes reiniciar el progreso de uno de ellos para todos los estudiantes:'
                : selector.value === 'general'
                    ? 'Listado global de estudiantes y su progreso general:'
                    : 'Progreso específico de un campo o materia sin administrador asignado. Puedes reiniciarlo para todos los estudiantes:';
        }

        async function reiniciarProgresoCampo() {
            if (!['superadmin', 'admin_menor'].includes(rolSesionActiva)) {
                alert('No tienes permiso para reiniciar el progreso.');
                return;
            }

            const selector = document.getElementById('userProgressScope');
            const scope = opcionesProgresoAdmin.find(opcion => opcion.key === selector.value);
            if (!scope) {
                alert('Selecciona un campo o materia permitido para reiniciar su progreso.');
                return;
            }

            const campos = obtenerCamposBD()[scope.cat] || [];
            const campoIndex = campos.findIndex(campo => campo.id === scope.fieldId);
            const campo = campos[campoIndex];
            const subjectIndex = scope.subjectId
                ? campo?.materias?.findIndex(materia => materia.id === scope.subjectId)
                : null;
            const objetivo = scope.subjectId
                ? subjectIndex >= 0 ? campo.materias[subjectIndex] : null
                : campo;
            if (!objetivo) {
                alert('El campo seleccionado ya no está disponible. Actualiza la pantalla e inténtalo de nuevo.');
                cargarTablaUsuariosAdmin();
                return;
            }

            if (rolSesionActiva === 'superadmin' && objetivo.adminAsignado) {
                alert('El Administrador Principal solo puede reiniciar campos sin administrador asignado.');
                cargarTablaUsuariosAdmin();
                return;
            }
            if (rolSesionActiva === 'admin_menor' && objetivo.adminAsignado !== adminMenorDatos?.user) {
                alert('Solo puedes reiniciar campos o materias que tienes asignados.');
                cargarTablaUsuariosAdmin();
                return;
            }

            const descripcion = scope.titulo.replace(/^(Campo|Materia): /, '');
            if (!confirm(
                `¿Reiniciar el progreso de "${descripcion}" para todos los estudiantes? ` +
                'Se borrarán las actividades completadas y los intentos de cuestionarios de este campo. ' +
                'Las actividades y el progreso de otros campos se conservarán.'
            )) {
                return;
            }

            const subIndex = subjectIndex === null ? 'main' : subjectIndex;
            const prefijo = `${scope.cat}_${campoIndex}_${subIndex}_`;
            const usuarios = obtenerUsuariosBD();
            let estudiantesActualizados = 0;
            let actividadesReiniciadas = 0;

            usuarios.forEach(estudiante => {
                let cambios = 0;
                for (const propiedad of ['progresoCompletado', 'intentosQuizzes']) {
                    const registros = estudiante[propiedad];
                    if (!registros || typeof registros !== 'object') continue;
                    for (const clave of Object.keys(registros)) {
                        if (clave.startsWith(prefijo)) {
                            delete registros[clave];
                            cambios++;
                        }
                    }
                }
                if (cambios) {
                    estudiantesActualizados++;
                    actividadesReiniciadas += cambios;
                }
            });

            const botonReinicio = document.getElementById('resetFieldProgressButton');
            botonReinicio.disabled = true;
            const guardado = await guardarUsuariosBD(usuarios);
            if (!guardado) {
                alert('No se pudo guardar el reinicio. Verifica la conexión con la base de datos.');
                return;
            }
            botonReinicio.disabled = false;
            document.getElementById('userProgressFilter').value = '';
            cargarTablaUsuariosAdmin();
            alert(
                `Progreso reiniciado para "${descripcion}". ` +
                `${estudiantesActualizados} estudiante(s) actualizado(s); ` +
                `se borraron ${actividadesReiniciadas} registros de progreso e intentos.`
            );
        }

        function normalizarBusqueda(texto) {
            return normalizarTexto(String(texto || ''))
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');
        }

        function actualizarOpcionesFiltroGrado(usuarios) {
            const filtro = document.getElementById('userGradeFilter');
            const seleccionado = filtro.value;
            filtro.replaceChildren(new Option('Todos los años escolares', ''));

            const grados = [...new Set(usuarios.map(usuario => usuario.grado || 'No asignado'))]
                .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
            grados.forEach(grado => {
                filtro.add(new Option(grado, normalizarBusqueda(grado)));
            });
            if ([...filtro.options].some(option => option.value === seleccionado)) {
                filtro.value = seleccionado;
            }
        }

     
        function cargarTablaUsuariosAdmin() {
            const tbody = document.getElementById('userTableBody');
            tbody.innerHTML = '';

            const usuarios = obtenerUsuariosBD();
            const totalGeneral = obtenerTotalActividadesGeneral();
            actualizarOpcionesProgresoAdmin();
            
            // FILTRO DE ESTUDIANTES SEGÚN ROL Y ASIGNACIÓN
            let usuariosFiltrados = usuarios;
            if (rolSesionActiva === 'admin_menor' && adminMenorDatos) {
                const asignaciones = obtenerCamposAsignadosAdmin(adminMenorDatos);
                const gradosAsignados = asignaciones.map(a => a.titulo.toLowerCase());
                
                usuariosFiltrados = usuarios.filter(usuario => {
                    const gradoEstudiante = (usuario.grado || '').toLowerCase();
                    return gradosAsignados.some(g => g.includes(gradoEstudiante) || gradoEstudiante.includes(g));
                });
            }

            const ordenados = usuariosFiltrados
                .map((usuario, indiceOriginal) => ({ usuario, indiceOriginal: usuarios.indexOf(usuario) }))
                .sort((a, b) => a.usuario.nombre.localeCompare(b.usuario.nombre, 'es', { sensitivity: 'base' }));

            actualizarOpcionesFiltroGrado(usuarios);
            ordenados.forEach(({ usuario, indiceOriginal }) => {
                const { completadas, porcentaje, totalActividades } = calcularProgresoAdmin(usuario, totalGeneral);
                let tr = document.createElement('tr');
                tr.className = 'user-row';
                tr.dataset.userIndex = indiceOriginal;
                tr.dataset.name = normalizarBusqueda(usuario.nombre);
                tr.dataset.grade = normalizarBusqueda(usuario.grado || 'No asignado');
                tr.dataset.progress = porcentaje;

                const nombre = document.createElement('td');
                const nombreNegrita = document.createElement('strong');
                nombreNegrita.textContent = usuario.nombre;
                nombre.appendChild(nombreNegrita);
                const grado = document.createElement('td');
                grado.textContent = usuario.grado || 'No asignado';
                const progreso = document.createElement('td');
                progreso.textContent = `${porcentaje}% (${completadas}/${totalActividades} actividades)`;
                const acciones = document.createElement('td');
                if (rolSesionActiva === 'superadmin') {
                    const botonEliminar = document.createElement('button');
                    botonEliminar.textContent = 'Eliminar Estudiante';
                    botonEliminar.style.cssText = 'background:var(--danger); color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer; font-weight:bold;';
                    botonEliminar.addEventListener('click', () => eliminarEstudiante(indiceOriginal));
                    acciones.appendChild(botonEliminar);
                } else {
                    const soloLectura = document.createElement('span');
                    soloLectura.textContent = 'Solo lectura';
                    soloLectura.style.cssText = 'color:#555; font-style:italic;';
                    acciones.appendChild(soloLectura);
                }
                tr.append(nombre, grado, progreso, acciones);
                tbody.appendChild(tr);
            });
            filtrarTablaUsuarios();
            actualizarConteoTablaUsuarios();
        } 

        function eliminarEstudiante(uIdx) {
            if (rolSesionActiva !== 'superadmin') {
                alert('Permiso denegado. Únicamente el Administrador Principal puede eliminar estudiantes.');
                return;
            }

            if (confirm('¿Estás seguro de eliminar este estudiante de la plataforma?')) {
                let usuarios = obtenerUsuariosBD();
                usuarios.splice(uIdx, 1);
                guardarUsuariosBD(usuarios);
                cargarTablaUsuariosAdmin();
            }
        }

        function filtrarTablaUsuarios() {
            const query = normalizarBusqueda(document.getElementById('userSearchInput').value);
            const grado = document.getElementById('userGradeFilter').value;
            const progreso = document.getElementById('userProgressFilter').value;
            document.querySelectorAll('.user-row').forEach(fila => {
                const porcentaje = Number(fila.dataset.progress);
                const coincideProgreso = !progreso || (progreso === '100'
                    ? porcentaje === 100
                    : porcentaje >= Number(progreso.split('-')[0])
                        && porcentaje <= Number(progreso.split('-')[1]));
                fila.style.display = (fila.dataset.name.includes(query) || fila.dataset.grade.includes(query))
                    && (!grado || fila.dataset.grade === grado)
                    && coincideProgreso ? '' : 'none';
            });
            actualizarConteoTablaUsuarios();
        }

        function actualizarConteoTablaUsuarios() {
            const filas = [...document.querySelectorAll('.user-row')];
            const visibles = filas.filter(fila => fila.style.display !== 'none').length;
            document.getElementById('userTableResults').textContent =
                `Mostrando ${visibles} de ${filas.length} estudiantes`;
        }

        function exportarProgresoCSV() {
            const usuarios = obtenerUsuariosBD();
            const totalActividades = obtenerTotalActividadesGeneral();
            const filasVisibles = [...document.querySelectorAll('.user-row')]
                .filter(fila => fila.style.display !== 'none');
            const csvValue = value => {
                let texto = String(value ?? '');
                if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
                return `"${texto.replace(/"/g, '""')}"`;
            };
            const filas = [
                ['Estudiante', 'Año escolar', 'Progreso (%)', 'Actividades completadas', 'Total de actividades']
                    .map(csvValue).join(',')
            ];
            filasVisibles.forEach(fila => {
                const estudiante = usuarios[Number(fila.dataset.userIndex)];
                if (!estudiante) return;
                const { completadas, porcentaje, totalActividades: totalVisible } =
                    calcularProgresoAdmin(estudiante, totalActividades);
                filas.push([
                    estudiante.nombre,
                    estudiante.grado || 'No asignado',
                    porcentaje,
                    completadas,
                    totalVisible
                ].map(csvValue).join(','));
            });

            const archivo = new Blob(['\uFEFF', filas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(archivo);
            const enlace = document.createElement('a');
            enlace.href = url;
            enlace.download = `progreso-estudiantil-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(enlace);
            enlace.click();
            enlace.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }

        function volverABiblioteca() {
            if (rolSesionActiva === 'admin_menor') {
                mostrarSelectorCamposAdmin();
                return;
            }
            campoActualIndex = null;
            subMateriaActualIndex = null;
            document.getElementById('campoViewSection').classList.add('hidden');
            document.getElementById('adminFieldSelector').classList.add('hidden');
            document.getElementById('bibliotecaSection').classList.remove('hidden');
            actualizarVisibilidadPanelesGenerales(true);
            actualizarEnlaceBiblioteca();
            renderizarBibliotecaCampos();
        }

        function irAInicio() {
            if (rolSesionActiva === 'admin_menor') {
                mostrarSelectorCamposAdmin();
                return;
            }
            volverABiblioteca();
        }

        window.addEventListener('load', () => {
            actualizarAccionesHeader();
            actualizarConteoPalabrasArticulo();
            actualizarConteosCuestionario();
            verificarCodigoIngreso();
        });
