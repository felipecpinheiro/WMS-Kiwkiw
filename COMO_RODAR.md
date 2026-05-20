# 🚀 Como Rodar o WMS Kiwkiw

Guia passo a passo para colocar o sistema no ar na sua máquina local.  
Você vai abrir **dois terminais**: um para o backend, outro para o frontend.

---

## Pré-requisitos — o que instalar primeiro

Antes de qualquer coisa, você precisa ter essas ferramentas instaladas no seu computador:

### 1. Python 3.11 ou superior
- Baixe em: https://www.python.org/downloads/
- Durante a instalação, **marque a opção "Add Python to PATH"**
- Para confirmar que instalou certo, abra o terminal e digite:
  ```
  python --version
  ```
  Deve aparecer algo como `Python 3.11.x`

### 2. Node.js 20 ou superior (LTS)
- Baixe em: https://nodejs.org/  (clique em "LTS")
- Para confirmar:
  ```
  node --version
  npm --version
  ```
  Deve aparecer `v20.x.x` e `10.x.x` (ou superior)

### 3. Git (opcional, mas recomendado)
- Baixe em: https://git-scm.com/
- Usado para versionar o código ao longo do desenvolvimento

---

## Estrutura de Pastas do Projeto

```
WMS Kiwkiw/
├── backend/          ← API Python (FastAPI)
│   ├── main.py
│   ├── models.py
│   ├── requirements.txt
│   ├── routers/
│   └── services/
├── frontend/         ← Interface React (Vite + Tailwind)
│   ├── package.json
│   └── src/
├── prototypes/       ← Protótipos HTML (só para referência visual)
└── COMO_RODAR.md     ← Este arquivo
```

---

## PARTE 1 — Rodando o Backend (API Python)

Abra um terminal na pasta do projeto.

### Passo 1 — Entre na pasta do backend
```bash
cd "WMS Kiwkiw/backend"
```

### Passo 2 — Crie um ambiente virtual Python
Isso isola as dependências do projeto sem bagunçar seu Python global.
```bash
python -m venv venv
```

### Passo 3 — Ative o ambiente virtual

**No Windows (PowerShell):**
```powershell
venv\Scripts\Activate.ps1
```
Se der erro de permissão no PowerShell, rode primeiro:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**No Windows (CMD):**
```cmd
venv\Scripts\activate.bat
```

**No Mac/Linux:**
```bash
source venv/bin/activate
```

Você saberá que funcionou quando aparecer `(venv)` no início da linha do terminal.

### Passo 4 — Instale as dependências
```bash
pip install -r requirements.txt
```
Isso pode demorar alguns minutos na primeira vez.

### Passo 5 — Crie as pastas de dados necessárias
```bash
mkdir data
mkdir media
mkdir exports
```
(No Windows CMD use `mkdir data`, `mkdir media`, `mkdir exports` separadamente)

### Passo 6 — Rode o servidor
```bash
uvicorn main:app --reload --port 8000
```

Se tudo correr bem, você verá:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO:     Application startup complete.
```

### ✅ Verificar que está funcionando
Abra no navegador: **http://localhost:8000/docs**

Deve aparecer a documentação interativa da API (Swagger UI) com todas as rotas listadas.

**Usuário admin criado automaticamente:**
- E-mail: `admin@kiwkiw.com.br`
- Senha: `kiwkiw2024`

---

## PARTE 2 — Rodando o Frontend (React)

Abra um **segundo terminal** (deixe o backend rodando no primeiro).

### Passo 1 — Entre na pasta do frontend
```bash
cd "WMS Kiwkiw/frontend"
```

### Passo 2 — Instale as dependências Node
```bash
npm install
```
Isso cria a pasta `node_modules` com todas as bibliotecas. Pode demorar 1-2 minutos.

### Passo 3 — Crie o arquivo de configuração de ambiente
Crie um arquivo chamado `.env` dentro da pasta `frontend` com o seguinte conteúdo:
```
VITE_API_URL=http://localhost:8000
```
Isso diz ao frontend onde está o backend.

### Passo 4 — Rode o servidor de desenvolvimento
```bash
npm run dev
```

Você verá:
```
  VITE v5.x.x  ready in xxx ms
  ➜  Local:   http://localhost:5173/
```

### ✅ Verificar que está funcionando
Abra no navegador: **http://localhost:5173**

Deve aparecer a tela de login do WMS Kiwkiw.

---

## Resumo — Os dois comandos para rodar todo dia

Uma vez que tudo estiver instalado, para subir o sistema você só precisa de:

**Terminal 1 (backend):**
```bash
cd "WMS Kiwkiw/backend"
venv\Scripts\activate.bat        # Windows
uvicorn main:app --reload --port 8000
```

**Terminal 2 (frontend):**
```bash
cd "WMS Kiwkiw/frontend"
npm run dev
```

Depois acesse: **http://localhost:5173**

---

## Visualizar os Protótipos HTML (sem precisar de nada instalado)

Os arquivos em `prototypes/` são HTMLs que abrem diretamente no navegador — basta dar dois cliques:
- `prototypes/dashboard.html` — cockpit master
- `prototypes/scanner.html` — interface de bipagem
- `prototypes/seller-portal.html` — portal do seller

---

## Problemas comuns

| Problema | Solução |
|----------|---------|
| `python` não reconhecido | Reinstale o Python marcando "Add to PATH" |
| `npm` não reconhecido | Reinstale o Node.js |
| Porta 8000 em uso | Troque para `--port 8001` e atualize o `.env` |
| Erro `CORS` no browser | Confirme que o backend está rodando em `:8000` |
| Página em branco no React | Abra o console do navegador (F12) para ver o erro |
| `venv\Scripts\Activate.ps1` bloqueado | Rode o comando de ExecutionPolicy acima |

---

## Próximos passos após rodar localmente

1. **Trocar a senha do admin** — acesse `/perfil` e altere `kiwkiw2024`
2. **Cadastrar sua(s) unidade(s)** — menu Cadastros → Unidades
3. **Cadastrar os sellers** — menu Cadastros → Sellers (com os ~54 sellers da planilha)
4. **Cadastrar produtos** — menu Cadastros → Produtos (importar da planilha `cadastro produtos`)
5. **Importar um pedido de teste** — Dashboard → botão "Importar Excel"

---

*Dúvidas? Abra o arquivo de código em questão e pergunte ao Claude no Cowork.*
