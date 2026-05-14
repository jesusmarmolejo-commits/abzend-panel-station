'use client'
import { useState } from 'react'
import { createClient } from '../../lib/supabase'
import { useRouter } from 'next/navigation'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const login = async () => {
    if (!email.trim() || !password.trim()) { setError('Email y contrasena requeridos'); return }
    setLoading(true); setError('')
    try {
      const supabase = createClient()
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (authError) throw authError
      const { data: userData } = await supabase.from('users').select('role').eq('auth_id', data.user.id).single()
      if (!userData || userData.role !== 'station') {
        await supabase.auth.signOut()
        throw new Error('Acceso denegado. Solo usuarios de estacion pueden ingresar.')
      }
      router.push('/station')
    } catch(e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh',background:'#085041'}}>
      <div style={{background:'#fff',borderRadius:16,padding:'2rem',width:'100%',maxWidth:380,textAlign:'center'}}>
        <h1 style={{fontSize:28,fontWeight:700,color:'#085041',letterSpacing:2,marginBottom:4}}>ABZEND</h1>
        <p style={{fontSize:13,color:'#888',marginBottom:'1.5rem'}}>Panel Estacion</p>
        {error && <p style={{background:'#FCEBEB',color:'#A32D2D',borderRadius:8,padding:'10px 12px',fontSize:13,marginBottom:'1rem'}}>{error}</p>}
        <div style={{marginBottom:12}}>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
            placeholder="correo@empresa.com"
            style={{width:'100%',padding:'10px 12px',border:'1px solid #ddd',borderRadius:8,fontSize:14,boxSizing:'border-box'}} />
        </div>
        <div style={{marginBottom:16}}>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
            placeholder="Contrasena" onKeyDown={e=>e.key==='Enter'&&login()}
            style={{width:'100%',padding:'10px 12px',border:'1px solid #ddd',borderRadius:8,fontSize:14,boxSizing:'border-box'}} />
        </div>
        <button onClick={login} disabled={loading}
          style={{width:'100%',padding:12,background:'#085041',color:'#fff',border:'none',borderRadius:8,fontSize:15,fontWeight:500,cursor:'pointer',opacity:loading?0.6:1}}>
          {loading?'Ingresando...':'Ingresar'}
        </button>
        <p style={{fontSize:12,color:'#aaa',marginTop:'1rem'}}>Al ingresar aceptas los terminos de uso de ABZEND</p>
      </div>
    </div>
  )
}