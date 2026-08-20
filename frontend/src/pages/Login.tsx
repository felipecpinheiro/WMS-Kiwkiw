/**
 * WMS Kiwkiw - Página de Login
 * Autenticação com email e senha, armazena JWT no localStorage.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Eye, EyeOff } from 'lucide-react';
import { authApi } from '../api';
import ThemeToggle from '../components/ThemeToggle';

interface LoginForm {
  email: string;
  password: string;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>();

  const onSubmit = async (data: LoginForm) => {
    setLoading(true);
    try {
      const response = await authApi.login(data.email, data.password);
      const res = response.data;

      localStorage.setItem('wms_token', res.access_token);
      localStorage.setItem('wms_user', JSON.stringify({
        id: res.user_id,
        name: res.name,
        role: res.role,
        unit_id: res.unit_id,
        seller_id: res.seller_id,
        force_password_change: !!(res as any).force_password_change,
      }));

      toast.success(`Bem-vindo, ${res.name}!`);

      // Redireciona cada perfil ao seu destino correto
      if (res.role === 'client') navigate('/portal');
      else if (res.role === 'operator') navigate('/manuseios');
      else navigate('/dashboard');
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Credenciais inválidas';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-start sm:items-center justify-center overflow-y-auto p-4 pt-14 sm:pt-4"
      style={{ background: 'linear-gradient(160deg, rgb(var(--app)) 0%, rgb(var(--sidebar)) 50%, rgb(var(--app)) 100%)' }}
    >
      <div className="fixed top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      {/* Decorative blobs */}
      <div
        className="fixed top-0 left-0 w-96 h-96 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(123,99,232,0.12) 0%, transparent 70%)', transform: 'translate(-30%, -30%)' }}
      />
      <div
        className="fixed bottom-0 right-0 w-96 h-96 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(61,217,164,0.08) 0%, transparent 70%)', transform: 'translate(30%, 30%)' }}
      />

      <div className="w-full max-w-sm relative z-10">

        {/* Logo area */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <img
              src="/logo.svg"
              alt="Kiwkiw"
              className="w-20 h-20 drop-shadow-2xl"
              style={{ filter: 'drop-shadow(0 8px 24px rgba(123,99,232,0.40))' }}
            />
          </div>
          <h1 className="text-t1 text-2xl font-bold mb-1">Kiwkiw WMS</h1>
          <p className="text-sm font-medium text-t4">
            Fulfillment Premium
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-6 border bg-surface/60 backdrop-blur-md border-brand-line"
          style={{
            boxShadow: '0 24px 48px rgba(0,0,0,0.40)',
          }}
        >
          <h2 className="text-t1 font-semibold text-lg mb-5">Entrar na plataforma</h2>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-xs font-medium mb-1.5 text-t3">
                E-mail
              </label>
              <input
                type="email"
                autoComplete="email"
                placeholder="seu@email.com"
                className="w-full rounded-xl px-3 py-3 text-t1 placeholder-t5 outline-none transition focus:ring-2 focus:ring-violet-500/50"
                style={{
                  background: 'rgb(var(--surface-2))',
                  border: errors.email ? '1px solid rgba(248,113,113,0.6)' : '1px solid rgb(var(--line))',
                  fontSize: '16px',
                }}
                {...register('email', {
                  required: 'E-mail obrigatório',
                  pattern: { value: /\S+@\S+\.\S+/, message: 'E-mail inválido' },
                })}
              />
              {errors.email && (
                <p className="text-bad text-xs mt-1">{errors.email.message}</p>
              )}
            </div>

            {/* Senha */}
            <div>
              <label className="block text-xs font-medium mb-1.5 text-t3">
                Senha
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full rounded-xl pl-3 pr-11 py-3 text-t1 placeholder-t5 outline-none transition focus:ring-2 focus:ring-violet-500/50"
                  style={{
                    background: 'rgb(var(--surface-2))',
                    border: errors.password ? '1px solid rgba(248,113,113,0.6)' : '1px solid rgb(var(--line))',
                    fontSize: '16px',
                  }}
                  {...register('password', { required: 'Senha obrigatória' })}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  tabIndex={-1}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-0 top-0 h-full w-11 flex items-center justify-center text-t4 hover:text-t3 transition"
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              {errors.password && (
                <p className="text-bad text-xs mt-1">{errors.password.message}</p>
              )}
            </div>

            {/* Botão */}
            <button
              type="submit"
              disabled={loading}
              className="w-full text-t1 font-semibold py-3.5 rounded-xl transition-all text-sm mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                background: loading ? '#5B47C8' : 'linear-gradient(135deg, #7B63E8 0%, #5B47C8 100%)',
                boxShadow: loading ? 'none' : '0 4px 16px rgba(123,99,232,0.35)',
              }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Entrando...
                </span>
              ) : 'Entrar'}
            </button>
          </form>
        </div>

        {/* Dev hint — remover em produção */}
        {import.meta.env.DEV && (
          <p className="text-center text-xs mt-4 text-t5">
            Dev: admin@kiwkiw.com.br / kiwkiw2024
          </p>
        )}
      </div>
    </div>
  );
}
