# Colita de Rana - Backend API 🐸

Backend API REST para la aplicación de telemedicina pediátrica Colita de Rana.

## Stack Tecnológico

- **Node.js** + Express
- **PostgreSQL** (Render)
- **JWT** para autenticación
- **bcrypt** para encriptación

## Estructura del Proyecto

```
colitaderana-api/
├── server.js              # Entry point
├── package.json
├── config/
│   └── database.js        # Conexión PostgreSQL
├── middleware/
│   └── auth.js            # JWT verification
├── routes/
│   ├── auth.js            # Login, registro
│   ├── users.js           # Perfil usuario
│   ├── patients.js        # CRUD pacientes (hijos)
│   ├── doctors.js         # Doctores
│   ├── consultations.js   # Consultas médicas
│   ├── messages.js        # Chat
│   └── payments.js        # Pagos
└── database/
    └── init.js            # Script crear tablas
```

## Configuración en Render

### 1. Crear Base de Datos PostgreSQL

Ya tenés una en Render. Podés usar la misma o crear una nueva.

### 2. Crear Web Service

1. En Render Dashboard → **New** → **Web Service**
2. Conectar tu repositorio de GitHub
3. Configurar:
   - **Name:** colitaderana-api
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free o Starter

### 3. Variables de Entorno

En Render → Tu servicio → Environment, agregar:

```
DATABASE_URL = [tu connection string de PostgreSQL]
NODE_ENV = production
JWT_SECRET = [genera_un_string_seguro_largo]
PORT = 3000
```

### 4. Inicializar Base de Datos

Después de deployar, ejecutar una vez para crear las tablas:

```bash
npm run db:init
```

## API Endpoints

### Autenticación
```
POST /api/auth/register     - Registrar usuario
POST /api/auth/login        - Login usuario
POST /api/auth/login/doctor - Login doctor
GET  /api/auth/me           - Usuario actual
```

### Usuarios
```
GET  /api/users/profile     - Obtener perfil
PUT  /api/users/profile     - Actualizar perfil
PUT  /api/users/password    - Cambiar contraseña
GET  /api/users/stats       - Estadísticas
```

### Pacientes (Hijos)
```
GET    /api/patients        - Listar pacientes
GET    /api/patients/:uid   - Obtener paciente
POST   /api/patients        - Crear paciente
PUT    /api/patients/:uid   - Actualizar paciente
DELETE /api/patients/:uid   - Eliminar paciente
```

### Doctores
```
GET  /api/doctors           - Listar doctores
GET  /api/doctors/online    - Doctores en línea
GET  /api/doctors/:uid      - Obtener doctor
POST /api/doctors/create    - Crear doctor (admin)
```

### Consultas
```
GET  /api/consultations          - Listar consultas
GET  /api/consultations/active   - Consultas activas
GET  /api/consultations/:uid     - Obtener consulta
POST /api/consultations          - Crear consulta
PUT  /api/consultations/:uid/status    - Cambiar estado
PUT  /api/consultations/:uid/diagnosis - Agregar diagnóstico
```

### Mensajes (Chat)
```
GET  /api/messages/:consultationUid    - Obtener mensajes
POST /api/messages                     - Enviar mensaje
PUT  /api/messages/read/:consultationUid - Marcar como leídos
GET  /api/messages/unread/count        - Contar no leídos
```

### Pagos
```
POST /api/payments/create    - Crear pago
POST /api/payments/webhook   - Webhook pagos
POST /api/payments/simulate  - Simular pago (dev)
GET  /api/payments/history   - Historial
GET  /api/payments/:uid      - Detalle pago
```

## Crear Doctora de Prueba

```bash
curl -X POST https://colitaderana-api.onrender.com/api/doctors/create \
  -H "Content-Type: application/json" \
  -d '{
    "email": "doctora@colitaderana.com",
    "password": "123456",
    "nombre": "María",
    "apellido": "González",
    "especialidad": "Pediatría",
    "subespecialidad": "Neonatología",
    "matricula": "12345",
    "bio": "Pediatra con 10 años de experiencia",
    "precioChat": 70000,
    "precioVideo": 120000
  }'
```

## Desarrollo Local

```bash
git clone https://github.com/Kyubipy/colitaderana-api.git
cd colitaderana-api

npm install

cp .env.example .env
# Editar .env con tus valores

npm run db:init
npm run dev
```

## Seguridad

- Contraseñas hasheadas con bcrypt (10 rounds)
- JWT con expiración de 30 días
- Validación de propiedad en todas las rutas
- Headers de seguridad con Helmet

---

**Colita de Rana** - Pediatría 24/7 para tu tranquilidad 🐸
