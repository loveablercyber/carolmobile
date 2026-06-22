import { useEffect, useState } from 'react'
import { Download, WifiOff, X } from 'lucide-react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { IntroPage, AuthPage } from './pages/Auth'
import { ClientArea } from './pages/client/ClientArea'
import { ProfessionalArea } from './pages/professional/ProfessionalArea'
import { AdminArea } from './pages/admin/AdminArea'
import { Logo } from './components/ui'
import { useAuth } from './context/AuthContext'

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

function InstallPrompt(){
  const [event,setEvent]=useState<InstallEvent|null>(null); const [hidden,setHidden]=useState(false)
  useEffect(()=>{const handler=(e:Event)=>{e.preventDefault();setEvent(e as InstallEvent)};window.addEventListener('beforeinstallprompt',handler);return()=>window.removeEventListener('beforeinstallprompt',handler)},[])
  if(!event||hidden)return null
  return <div className="fixed bottom-24 left-1/2 z-[60] flex w-[calc(100%-24px)] max-w-lg -translate-x-1/2 items-center gap-3 rounded-[22px] border border-white/10 bg-ink p-3 text-white shadow-2xl lg:bottom-6"><Logo compact light/><div className="min-w-0 flex-1"><b className="block text-xs">Instale a Carol Sol</b><span className="block truncate text-[9px] text-white/45">Acesso rápido, lembretes e experiência em tela cheia.</span></div><button onClick={async()=>{await event.prompt();setHidden(true)}} className="rounded-xl bg-champagne px-3 py-2 text-[10px] font-bold"><Download size={14} className="mr-1 inline"/>Instalar</button><button onClick={()=>setHidden(true)} className="text-white/40"><X size={15}/></button></div>
}

function ConnectionBanner(){
  const [online,setOnline]=useState(navigator.onLine)
  useEffect(()=>{const on=()=>setOnline(true),off=()=>setOnline(false);window.addEventListener('online',on);window.addEventListener('offline',off);return()=>{window.removeEventListener('online',on);window.removeEventListener('offline',off)}},[])
  return online?null:<div className="fixed inset-x-0 top-0 z-[110] flex items-center justify-center gap-2 bg-amber-100 px-4 py-2 text-[11px] font-bold text-amber-900"><WifiOff size={14}/>Você está offline. Consultas salvas continuam disponíveis.</div>
}

export default function App(){
  return <><ConnectionBanner/><Routes><Route path="/" element={<IntroPage/>}/><Route path="/entrar" element={<AuthPage/>}/><Route path="/cadastro" element={<AuthPage/>}/><Route path="/recuperar" element={<AuthPage/>}/><Route path="/redefinir" element={<AuthPage/>}/><Route path="/cliente/*" element={<Protected role="client"><ClientArea/></Protected>}/><Route path="/profissional/*" element={<Protected role="professional"><ProfessionalArea/></Protected>}/><Route path="/admin/*" element={<Protected role="admin"><AdminArea/></Protected>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes><InstallPrompt/></>
}

function Protected({role,children}:{role:'client'|'professional'|'admin';children:React.ReactNode}){
  const {user,loading}=useAuth()
  if(loading)return <div className="fixed inset-0 grid place-items-center bg-cream"><Logo/></div>
  if(!user)return <Navigate to="/entrar" replace/>
  if(user.role!==role){const destination=user.role==='client'?'/cliente/inicio':user.role==='professional'?'/profissional/dashboard':'/admin/dashboard';return <Navigate to={destination} replace/>}
  return children
}
