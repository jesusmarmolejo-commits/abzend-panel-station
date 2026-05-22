'use client'
import { useEffect, useState } from 'react'
import { createClient } from '../../lib/supabase'
import { useRouter } from 'next/navigation'

const STATUS_LABEL = {
  pending:'Pendiente', assigned:'Asignado', picked_up:'Recolectado',
  en_estacion:'En Estación', in_transit:'En Ruta', delivered:'Entregado',
  intento_fallido:'Intento Fallido', regreso_a_cliente:'Regreso a Cliente',
  devuelto_a_remitente:'Devuelto a Remitente', cancelled:'Cancelado'
}
const STATUS_COLOR = {
  pending:'#FAEEDA', assigned:'#E1F5EE', picked_up:'#EFF6FF',
  en_estacion:'#F3E8FF', in_transit:'#E6F1FB', delivered:'#EAF3DE',
  intento_fallido:'#FEE2E2', regreso_a_cliente:'#FEE2E2',
  devuelto_a_remitente:'#F3F4F6', cancelled:'#FCEBEB'
}
const STATUS_TEXT = {
  pending:'#854F0B', assigned:'#0F6E56', picked_up:'#185FA5',
  en_estacion:'#7C3AED', in_transit:'#185FA5', delivered:'#3B6D11',
  intento_fallido:'#991B1B', regreso_a_cliente:'#991B1B',
  devuelto_a_remitente:'#374151', cancelled:'#A32D2D'
}

const fmtDate = (d) => d ? new Date(d).toLocaleString('es-MX',{dateStyle:'short',timeStyle:'short'}) : ''

export default function StationPanel() {
  const [user, setUser]             = useState(null)
  const [userId, setUserId]         = useState(null)
  const [orders, setOrders]         = useState([])
  const [drivers, setDrivers]       = useState([])
  const [stationOrders, setStationOrders]   = useState([])
  const [pendingDrivers, setPendingDrivers] = useState([])
  const [routes, setRoutes]                 = useState([])
  const [routeFilterDate, setRouteFilterDate] = useState(new Date().toISOString().slice(0,10))
  const [loading, setLoading]       = useState(true)
  const [activeTab, setActiveTab]   = useState('recibir')
  const [pages, setPages]           = useState({recibir:1,despachar:1,devoluciones:1,activas:1,estacion:1,antirobo:1,rutas:1})
  const PAGE_SIZE = 20
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [selectedDriver, setSelectedDriver] = useState('')
  const [processing, setProcessing] = useState(false)
  const [msg, setMsg]               = useState('')
  const [search, setSearch]         = useState('')
  const router = useRouter()

  useEffect(() => {
    const init = async () => {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }
      setUser(session.user)
      const { data: userData } = await supabase.from('users')
        .select('id, role').eq('auth_id', session.user.id).single()
      if (!userData || !['station','admin'].includes(userData.role)) {
        router.push('/login'); return
      }
      setUserId(userData.id)
      await loadAll(supabase)
      setLoading(false)
    }
    init()
  }, [])

  const loadAll = async (supabase) => {
    const [
      { data: ordersData },
      { data: driversData },
      { data: stationData },
      { data: pendingData },
      { data: routesData }
    ] = await Promise.all([
      supabase.from('orders')
        .select('*, client:client_id(full_name,phone), driver:driver_id(id,user_id,users(full_name))')
        .not('status', 'in', '("delivered","cancelled","devuelto_a_remitente")')
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('drivers')
        .select('id, user:user_id(full_name,email)')
        .eq('status', 'online'),
      supabase.rpc('get_station_orders'),
      supabase.rpc('get_drivers_with_pending_returns'),
      supabase.from('routes')
        .select('*, driver:driver_id(id,user:user_id(full_name,phone)), items:route_items(id,item_type,order_id,transport_order_id)')
        .order('created_at', { ascending: false })
        .limit(100),
    ])
    setOrders(ordersData || [])
    setDrivers(driversData || [])
    setStationOrders(Array.isArray(stationData) ? stationData : [])
    setPendingDrivers(Array.isArray(pendingData) ? pendingData : [])
    setRoutes(routesData || [])
    if (driversData?.length > 0) setSelectedDriver(driversData[0].id)
  }

  const searchOrder = async () => {
    if (!search.trim()) return
    const supabase = createClient()
    const { data } = await supabase.from('orders')
      .select('*, client:client_id(full_name,phone), driver:driver_id(id,user_id,users(full_name))')
      .eq('tracking_code', search.trim().replace('#','').toUpperCase())
      .single()
    if (!data) { setMsg('❌ Guía no encontrada'); return }
    setSelectedOrder(data)
    setSearch('')
  }

  const receiveAtStation = async (order) => {
    setProcessing(true)
    try {
      const supabase = createClient()
      await supabase.from('orders').update({
        status: 'en_estacion', status_updated_at: new Date().toISOString()
      }).eq('id', order.id)
      await supabase.from('order_events').insert({
        order_id: order.id, status: 'en_estacion',
        status_code: 'STO', note: 'Paquete recibido en estación', created_by: userId
      })
      setMsg(`✅ ${order.tracking_code} recibido en estación`)
      setSelectedOrder(null)
      await loadAll(supabase)
    } catch(e) { setMsg('❌ Error: '+e.message) }
    finally { setProcessing(false) }
  }

  const dispatchToDriver = async (order) => {
    if (!selectedDriver) { setMsg('❌ Selecciona un repartidor'); return }
    setProcessing(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.rpc('dispatch_order_to_driver', {
        p_order_id: order.id,
        p_driver_id: selectedDriver,
        p_station_user_id: userId
      })
      if (error) throw error
      setMsg(`✅ ${order.tracking_code} despachado al repartidor`)
      setSelectedOrder(null)
      await loadAll(supabase)
    } catch(e) { setMsg('❌ Error: '+e.message) }
    finally { setProcessing(false) }
  }

  const receiveReturn = async (order) => {
    setProcessing(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.rpc('receive_return_at_station', {
        p_order_id: order.id,
        p_station_user_id: userId
      })
      if (error) throw error
      setMsg(`✅ ${order.tracking_code} recibido como devolución — listo para re-despachar`)
      setSelectedOrder(null)
      await loadAll(supabase)
    } catch(e) { setMsg('❌ Error: '+e.message) }
    finally { setProcessing(false) }
  }

  const markReturnedToSender = async (order) => {
    setProcessing(true)
    try {
      const supabase = createClient()
      await supabase.from('orders').update({
        status: 'devuelto_a_remitente', status_updated_at: new Date().toISOString()
      }).eq('id', order.id)
      await supabase.from('order_events').insert({
        order_id: order.id, status: 'devuelto_a_remitente',
        status_code: 'DVS', note: 'Devuelto al remitente por 3 intentos fallidos', created_by: userId
      })
      setMsg(`📦 ${order.tracking_code} marcado como Devuelto a Remitente`)
      setSelectedOrder(null)
      await loadAll(supabase)
    } catch(e) { setMsg('❌ Error: '+e.message) }
    finally { setProcessing(false) }
  }

  const logout = async () => { await createClient().auth.signOut(); router.push('/login') }

  if (loading) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh',background:'#085041'}}>
      <div style={{background:'#fff',borderRadius:16,padding:'2rem',textAlign:'center'}}>
        <p style={{color:'#085041',fontWeight:600}}>Cargando...</p>
      </div>
    </div>
  )

  const byStatus = (statuses) => orders.filter(o => statuses.includes(o.status))
  const porRecibir    = byStatus(['picked_up'])
  const enEstacion    = byStatus(['en_estacion'])
  const devoluciones  = byStatus(['regreso_a_cliente'])
  const activas       = byStatus(['picked_up','en_estacion','in_transit','intento_fallido','regreso_a_cliente'])

  const todayRoutes   = routes.filter(r => r.date === routeFilterDate)
  const routesEnRuta  = todayRoutes.filter(r => r.status === 'EN_RUTA')
  const now           = new Date()
  const delayedOrders = orders.filter(o =>
    o.status === 'in_transit' &&
    o.status_updated_at &&
    (now - new Date(o.status_updated_at)) > 6 * 60 * 60 * 1000
  )

  const TABS = [
    { id:'recibir',      label:'📥 Recibir',       count: porRecibir.length,    color:'#185FA5' },
    { id:'despachar',    label:'🚚 Despachar',      count: enEstacion.length,    color:'#7C3AED' },
    { id:'rutas',        label:'🗺️ Rutas',          count: todayRoutes.length,   color:'#085041', alert: delayedOrders.length > 0 },
    { id:'devoluciones', label:'🔄 Devoluciones',   count: devoluciones.length,  color:'#DC2626' },
    { id:'estacion',     label:'📦 Mi Estación',    count: stationOrders.length, color:'#085041' },
    { id:'antirobo',     label:'🚨 Anti-Robo',      count: pendingDrivers.length,color:'#DC2626' },
    { id:'activas',      label:'📋 Activas',        count: activas.length,       color:'#374151' },
  ]

  const tabOrders = {
    recibir: porRecibir, despachar: enEstacion,
    devoluciones: devoluciones, activas: activas,
    rutas: [], estacion: [], antirobo: []
  }

  const setPage = (tab, p) => setPages(prev => ({...prev, [tab]: p}))
  const paginate = (arr, tab) => {
    const p = pages[tab] || 1
    return arr.slice((p-1)*PAGE_SIZE, p*PAGE_SIZE)
  }
  const totalPages = (arr) => Math.max(1, Math.ceil(arr.length / PAGE_SIZE))

  const Pagination = ({arr, tab}) => {
    const total = totalPages(arr)
    const cur   = pages[tab] || 1
    if (total <= 1) return null
    return (
      <div style={{display:'flex',justifyContent:'center',alignItems:'center',gap:8,marginTop:'1rem'}}>
        <button onClick={()=>setPage(tab,cur-1)} disabled={cur===1}
          style={{padding:'6px 14px',border:'1px solid #ddd',borderRadius:8,cursor:'pointer',fontSize:16,background:'#fff',opacity:cur===1?0.4:1}}>
          ‹
        </button>
        <span style={{fontSize:16,color:'#888'}}>{cur} / {total}</span>
        <button onClick={()=>setPage(tab,cur+1)} disabled={cur===total}
          style={{padding:'6px 14px',border:'1px solid #ddd',borderRadius:8,cursor:'pointer',fontSize:16,background:'#fff',opacity:cur===total?0.4:1}}>
          ›
        </button>
      </div>
    )
  }

  return (
    <div style={s.container}>
      <div style={s.topbar}>
        <div style={s.logo}>ABZEND <span style={s.tag}>Estación</span></div>
        <div style={s.userRow}>
          <span style={s.userName}>{user?.user_metadata?.full_name || user?.email}</span>
          <button onClick={logout} style={s.logoutBtn}>Salir</button>
        </div>
      </div>

      <div style={s.main}>
        {msg && <div style={s.msgBox} onClick={()=>setMsg('')}>{msg} ✕</div>}

        {/* Buscar */}
        <div style={s.card}>
          <div style={s.cardTitle}>Escanear / Buscar guía</div>
          <div style={s.qrRow}>
            <input style={s.qrInput} placeholder="Número de tracking..."
              value={search} onChange={e=>setSearch(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&searchOrder()} />
            <button style={s.qrBtn} onClick={searchOrder}>Buscar</button>
          </div>
        </div>

        {/* Stats */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:'1rem'}}>
          {TABS.map(tab=>(
            <div key={tab.id} style={{background:'#fff',border:'1px solid #eee',borderRadius:10,padding:'0.75rem',textAlign:'center',cursor:'pointer'}}
              onClick={()=>setActiveTab(tab.id)}>
              <div style={{fontSize:22,fontWeight:700,color:tab.color}}>{tab.count}</div>
              <div style={{fontSize:11,color:'#888',marginTop:2}}>{tab.label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',borderBottom:'1px solid #eee',marginBottom:'1rem',gap:0}}>
          {TABS.map(tab=>(
            <button key={tab.id} onClick={()=>setActiveTab(tab.id)}
              style={{padding:'8px 4px',border:'none',background:'none',cursor:'pointer',
                fontSize:10,whiteSpace:'nowrap',textAlign:'center',
                color:activeTab===tab.id?tab.color:'#888',fontWeight:activeTab===tab.id?700:400,
                borderBottom:activeTab===tab.id?`2px solid ${tab.color}`:'2px solid transparent',
                marginBottom:-1,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
              <span style={{fontSize:20}}>{tab.label.split(' ')[0]}</span>
              <span style={{fontSize:21,lineHeight:1.2}}>{tab.label.split(' ').slice(1).join(' ')}</span>
              {tab.count > 0 && (
                <span style={{background:tab.color,color:'#fff',fontSize:20,padding:'0px 5px',borderRadius:8,fontWeight:700,lineHeight:'24px'}}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Lista — solo para tabs de órdenes */}
        {!['rutas','estacion','antirobo'].includes(activeTab) && (
        <div style={s.ordersList}>
          {(tabOrders[activeTab]||[]).length === 0 && (
            <div style={s.empty}><p style={s.emptyText}>No hay órdenes en esta categoría</p></div>
          )}
          {paginate(tabOrders[activeTab]||[], activeTab).map(order=>(
            <div key={order.id} style={s.orderCard} onClick={()=>setSelectedOrder(order)}>
              <div style={s.orderRow}>
                <div style={s.orderLeft}>
                  <div style={s.orderCode}>#{order.tracking_code}</div>
                  <div style={s.orderRoute}>{order.origin_address?.substring(0,40)} → {order.dest_address?.substring(0,40)}</div>
                  <div style={s.orderMeta}>
                    {order.client?.full_name || '—'} · {fmtDate(order.created_at)}
                    {order.intentos_entrega > 0 && <span style={{color:'#DC2626',marginLeft:8}}>⚠️ {order.intentos_entrega} intentos</span>}
                  </div>
                </div>
                <span style={{...s.badge,background:STATUS_COLOR[order.status],color:STATUS_TEXT[order.status]}}>
                  {STATUS_LABEL[order.status]}
                </span>
              </div>
            </div>
          ))}
          <Pagination arr={tabOrders[activeTab]||[]} tab={activeTab} />
        </div>
        )}

        {/* TAB MI ESTACIÓN */}
        {activeTab === 'estacion' && (
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1rem'}}>
              <h2 style={{fontSize:15,fontWeight:600}}>Órdenes que pasaron por esta estación</h2>
              <span style={{fontSize:12,color:'#888'}}>{stationOrders.length} órdenes</span>
            </div>
            {stationOrders.length === 0
              ? <div style={s.empty}><p style={s.emptyText}>No hay órdenes registradas en esta estación</p></div>
              : paginate(stationOrders, 'estacion').map((o,i) => (
                <div key={i} style={{...s.orderCard,marginBottom:8,cursor:'pointer'}} onClick={()=>setSelectedOrder(orders.find(ord=>ord.id===o.id)||o)}>
                  <div style={s.orderRow}>
                    <div style={s.orderLeft}>
                      <div style={s.orderCode}>#{o.tracking_code}</div>
                      <div style={s.orderRoute}>{o.dest_address?.substring(0,50)}</div>
                      <div style={s.orderMeta}>
                        {o.driver_name ? `🚚 ${o.driver_name}` : 'Sin repartidor'}
                        {o.intentos_entrega > 0 && <span style={{color:'#DC2626',marginLeft:8}}>⚠️ {o.intentos_entrega} intentos</span>}
                      </div>
                    </div>
                    <span style={{...s.badge,background:STATUS_COLOR[o.status]||'#eee',color:STATUS_TEXT[o.status]||'#333'}}>
                      {STATUS_LABEL[o.status]||o.status}
                    </span>
                  </div>
                </div>
              ))
            }
            <Pagination arr={stationOrders} tab="estacion" />
          </div>
        )}

        {/* TAB RUTAS DEL DÍA */}
        {activeTab === 'rutas' && (
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1rem'}}>
              <h2 style={{fontSize:15,fontWeight:600}}>Rutas del día</h2>
              <input type="date" value={routeFilterDate}
                onChange={e=>setRouteFilterDate(e.target.value)}
                style={{padding:'6px 10px',border:'1px solid #ddd',borderRadius:8,fontSize:13}} />
            </div>

            {/* Tabla de órdenes con delay >6h */}
            {delayedOrders.length > 0 && (
              <div style={{background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:10,marginBottom:'1rem',overflow:'hidden'}}>
                <div style={{padding:'12px 16px',borderBottom:'1px solid #FECACA'}}>
                  <p style={{fontSize:18,color:'#991B1B',margin:0,fontWeight:700}}>
                    🚨 {delayedOrders.length} orden{delayedOrders.length!==1?'es':''} con más de 6 horas sin entrega
                  </p>
                </div>
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:16}}>
                    <thead>
                      <tr style={{background:'#FEE2E2'}}>
                        {['Guía','Repartidor','Ruta','Última actualización','Destino'].map(h=>(
                          <th key={h} style={{textAlign:'left',padding:'10px 12px',color:'#991B1B',fontWeight:600,fontSize:15,whiteSpace:'nowrap'}}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {paginate(delayedOrders,'rutas').map((o,i)=>{
                        const horasRetraso = Math.floor((now - new Date(o.status_updated_at)) / (1000*60*60))
                        const route = routes.find(r => r.items?.some(it => it.order_id === o.id))
                        return (
                          <tr key={i} style={{borderBottom:'1px solid #FECACA',background:i%2===0?'#fff':'#FFF5F5'}}>
                            <td style={{padding:'10px 12px',fontWeight:700,color:'#222'}}>{o.tracking_code}</td>
                            <td style={{padding:'10px 12px',color:'#444'}}>
                              {o.driver?.user?.full_name||'Sin asignar'}
                              {o.driver?.user?.phone && <div style={{fontSize:13,color:'#888'}}>{o.driver.user.phone}</div>}
                            </td>
                            <td style={{padding:'10px 12px',color:'#185FA5',fontWeight:600}}>
                              {route?.route_code||'—'}
                            </td>
                            <td style={{padding:'10px 12px',color:'#DC2626',fontWeight:600,whiteSpace:'nowrap'}}>
                              {fmtDate(o.status_updated_at)}
                              <div style={{fontSize:13,color:'#991B1B'}}>⏱️ {horasRetraso}h de retraso</div>
                            </td>
                            <td style={{padding:'10px 12px',color:'#555',fontSize:14}}>
                              {o.dest_address?.substring(0,40)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{padding:'8px 16px'}}>
                  <Pagination arr={delayedOrders} tab="rutas" />
                </div>
              </div>
            )}

            {/* Stats del día */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:'1rem'}}>
              {[
                {label:'Total',       value:todayRoutes.length,                            color:'#374151'},
                {label:'En Ruta',     value:routesEnRuta.length,                           color:'#1E40AF'},
                {label:'Completadas', value:todayRoutes.filter(r=>r.status==='COMPLETADA').length, color:'#166534'},
                {label:'Delay >6h',   value:delayedOrders.length,                          color:'#DC2626'},
              ].map((k,i)=>(
                <div key={i} style={{background:'#fff',border:'1px solid #eee',borderRadius:10,padding:'0.75rem',textAlign:'center'}}>
                  <div style={{fontSize:22,fontWeight:700,color:k.color}}>{k.value}</div>
                  <div style={{fontSize:11,color:'#888',marginTop:2}}>{k.label}</div>
                </div>
              ))}
            </div>

            {/* Lista de rutas */}
            {todayRoutes.length === 0
              ? <div style={s.empty}><p style={s.emptyText}>No hay rutas para esta fecha</p></div>
              : paginate(todayRoutes,'rutas').map((route,i) => {
                const total = route.items?.length || 0
                const statusColor = {CREADA:'#FAEEDA',EN_RUTA:'#E6F1FB',COMPLETADA:'#DCFCE7',CANCELADA:'#FEE2E2'}
                const statusText  = {CREADA:'#92400E',EN_RUTA:'#1E40AF',COMPLETADA:'#166534',CANCELADA:'#991B1B'}
                return (
                  <div key={i} style={{background:'#fff',border:'1px solid #eee',borderRadius:10,padding:'1rem',marginBottom:8}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                      <div>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                          <span style={{fontSize:13,fontWeight:700}}>{route.route_code}</span>
                          <span style={{fontSize:10,padding:'2px 6px',borderRadius:10,
                            background:route.type==='linehaul'?'#EFF6FF':'#F0FDF4',
                            color:route.type==='linehaul'?'#1E40AF':'#166534',fontWeight:600}}>
                            {route.type==='linehaul'?'🚛 Linehaul':'📦 Local'}
                          </span>
                        </div>
                        <div style={{fontSize:12,color:'#888'}}>
                          🚚 {route.driver?.user?.full_name||'Sin repartidor'}
                          {route.driver?.user?.phone && ` · ${route.driver.user.phone}`}
                        </div>
                      </div>
                      <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
                        <span style={{fontSize:11,padding:'2px 8px',borderRadius:20,fontWeight:600,
                          background:statusColor[route.status]||'#eee',color:statusText[route.status]||'#333'}}>
                          {route.status}
                        </span>
                        <span style={{fontSize:11,color:'#888'}}>{total} guías</span>
                      </div>
                    </div>
                  </div>
                )
              })
            }
            <Pagination arr={todayRoutes} tab="rutas" />
          </div>
        )}

        {/* TAB ANTI-ROBO */}
        {activeTab === 'antirobo' && (
          <div>
            <div style={{background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:10,padding:'12px 16px',marginBottom:'1rem'}}>
              <p style={{fontSize:13,color:'#991B1B',margin:0,fontWeight:600}}>
                🚨 Repartidores con guías pendientes por regresar a estación
              </p>
              <p style={{fontSize:12,color:'#B91C1C',margin:'4px 0 0'}}>
                Verificar físicamente que el repartidor entregue todas las guías antes de cerrar turno
              </p>
            </div>

            {pendingDrivers.length === 0
              ? (
                <div style={{...s.empty,background:'#F0FDF4',border:'1px solid #BBF7D0'}}>
                  <p style={{fontSize:14,color:'#166534',fontWeight:600}}>✅ Sin pendientes</p>
                  <p style={{fontSize:12,color:'#16a34a'}}>Todos los repartidores tienen sus guías en orden</p>
                </div>
              )
              : paginate(pendingDrivers,'antirobo').map((driver, i) => (
                <div key={i} style={{background:'#fff',border:'2px solid #FECACA',borderRadius:10,padding:'1rem',marginBottom:8}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                    <div>
                      <div style={{fontSize:14,fontWeight:700,color:'#222'}}>🚚 {driver.driver_name}</div>
                      <div style={{fontSize:12,color:'#888'}}>{driver.driver_phone || 'Sin teléfono'}</div>
                    </div>
                    <span style={{background:'#FEE2E2',color:'#991B1B',fontSize:12,fontWeight:700,padding:'4px 10px',borderRadius:20}}>
                      {driver.guias_pendientes} guía{driver.guias_pendientes !== 1 ? 's' : ''} pendiente{driver.guias_pendientes !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div style={{borderTop:'1px solid #FEE2E2',paddingTop:8}}>
                    {(driver.ordenes || []).map((o, j) => (
                      <div key={j} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 0',borderBottom:'1px solid #fafafa'}}>
                        <div>
                          <span style={{fontSize:12,fontWeight:600,color:'#222'}}>#{o.tracking_code}</span>
                          <span style={{fontSize:11,color:'#888',marginLeft:8}}>{o.dest_address?.substring(0,35)}</span>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:6}}>
                          {o.intentos > 0 && <span style={{fontSize:10,color:'#DC2626'}}>⚠️ {o.intentos} intentos</span>}
                          <span style={{...s.badge,fontSize:10,background:STATUS_COLOR[o.status]||'#eee',color:STATUS_TEXT[o.status]||'#333'}}>
                            {STATUS_LABEL[o.status]||o.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            }
            <Pagination arr={pendingDrivers} tab="antirobo" />
          </div>
        )}

        {/* MODAL */}
        {selectedOrder && (
          <div style={s.modalOverlay}>
            <div style={s.modal}>
              <h3 style={s.modalTitle}>#{selectedOrder.tracking_code}</h3>
              <p style={s.modalSub}>{selectedOrder.origin_address}</p>
              <p style={s.modalSub}>→ {selectedOrder.dest_address}</p>
              <p style={s.modalSub}>Cliente: {selectedOrder.client?.full_name || '—'}</p>
              {selectedOrder.intentos_entrega > 0 && (
                <div style={{background:'#FEE2E2',borderRadius:8,padding:'8px 12px',marginBottom:'1rem',fontSize:13,color:'#991B1B'}}>
                  ⚠️ Intentos fallidos: <strong>{selectedOrder.intentos_entrega}/3</strong>
                  {selectedOrder.rejection_reason && <span> — {selectedOrder.rejection_reason}</span>}
                </div>
              )}
              <div style={{marginBottom:'1rem',display:'flex',alignItems:'center',gap:8}}>
                <span style={s.label}>Estado:</span>
                <span style={{...s.badge,background:STATUS_COLOR[selectedOrder.status],color:STATUS_TEXT[selectedOrder.status]}}>
                  {STATUS_LABEL[selectedOrder.status]}
                </span>
              </div>

              {/* ACCIONES POR ESTADO */}
              {selectedOrder.status === 'picked_up' && (
                <button style={{...s.confirmBtn,width:'100%',marginBottom:8,background:'#7C3AED'}}
                  onClick={()=>receiveAtStation(selectedOrder)} disabled={processing}>
                  {processing?'Procesando...':'📥 Recibir en Estación'}
                </button>
              )}

              {selectedOrder.status === 'en_estacion' && (
                <>
                  <div style={s.field}>
                    <label style={s.label}>Asignar repartidor</label>
                    <select style={s.input} value={selectedDriver} onChange={e=>setSelectedDriver(e.target.value)}>
                      {drivers.length === 0
                        ? <option value="">Sin repartidores disponibles</option>
                        : drivers.map(d=>(
                          <option key={d.id} value={d.id}>
                            {d.user?.full_name || d.user?.email || d.id}
                          </option>
                        ))
                      }
                    </select>
                  </div>
                  <button style={{...s.confirmBtn,width:'100%',marginBottom:8}}
                    onClick={()=>dispatchToDriver(selectedOrder)} disabled={processing||!selectedDriver}>
                    {processing?'Despachando...':'🚚 Despachar a Repartidor'}
                  </button>
                </>
              )}

              {selectedOrder.status === 'regreso_a_cliente' && (
                <>
                  <button style={{...s.confirmBtn,width:'100%',marginBottom:8,background:'#7C3AED'}}
                    onClick={()=>receiveReturn(selectedOrder)} disabled={processing}>
                    {processing?'Procesando...':'📥 Recibir Devolución → Re-despachar'}
                  </button>
                  <button style={{...s.confirmBtn,width:'100%',marginBottom:8,background:'#DC2626'}}
                    onClick={()=>markReturnedToSender(selectedOrder)} disabled={processing}>
                    {processing?'Procesando...':'📦 Marcar Devuelto a Remitente'}
                  </button>
                </>
              )}

              <button style={{...s.cancelBtn,width:'100%'}} onClick={()=>setSelectedOrder(null)}>
                Cerrar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const s = {
  container:    { minHeight:'100vh', background:'#f5f5f5', fontFamily:'sans-serif' },
  topbar:       { background:'#085041', padding:'1rem 1.5rem', display:'flex', justifyContent:'space-between', alignItems:'center' },
  logo:         { fontSize:28, fontWeight:700, color:'#fff', letterSpacing:2, display:'flex', alignItems:'center', gap:10 },
  tag:          { background:'rgba(255,255,255,0.2)', fontSize:16, padding:'2px 8px', borderRadius:20, fontWeight:400 },
  userRow:      { display:'flex', alignItems:'center', gap:12 },
  userName:     { color:'rgba(255,255,255,0.8)', fontSize:20 },
  logoutBtn:    { padding:'6px 14px', background:'rgba(255,255,255,0.15)', color:'#fff', border:'1px solid rgba(255,255,255,0.3)', borderRadius:8, cursor:'pointer', fontSize:18 },
  main:         { maxWidth:700, margin:'0 auto', padding:'1.5rem' },
  msgBox:       { background:'#E1F5EE', border:'1px solid #9FE1CB', borderRadius:8, padding:'10px 14px', color:'#085041', marginBottom:'1rem', fontSize:20, cursor:'pointer' },
  card:         { background:'#fff', border:'1px solid #eee', borderRadius:10, padding:'1rem', marginBottom:'1rem' },
  cardTitle:    { fontSize:20, fontWeight:600, color:'#222', marginBottom:'0.75rem' },
  qrRow:        { display:'flex', gap:8 },
  qrInput:      { flex:1, padding:'9px 11px', border:'1px solid #ddd', borderRadius:8, fontSize:20, color:'#222' },
  qrBtn:        { padding:'9px 18px', background:'#085041', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:20, fontWeight:500 },
  ordersList:   { display:'flex', flexDirection:'column', gap:8 },
  orderCard:    { background:'#fff', border:'1px solid #eee', borderRadius:10, padding:'1rem', cursor:'pointer' },
  orderRow:     { display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 },
  orderLeft:    { flex:1 },
  orderCode:    { fontSize:20, fontWeight:600, color:'#222', marginBottom:3 },
  orderRoute:   { fontSize:17, color:'#888', marginBottom:2 },
  orderMeta:    { fontSize:16, color:'#bbb' },
  badge:        { fontSize:16, padding:'3px 10px', borderRadius:20, fontWeight:500, whiteSpace:'nowrap' },
  empty:        { textAlign:'center', padding:'2rem', background:'#fff', borderRadius:10, border:'1px solid #eee' },
  emptyText:    { color:'#aaa', fontSize:18 },
  modalOverlay: { position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 },
  modal:        { background:'#fff', borderRadius:14, padding:'1.5rem', width:'100%', maxWidth:420, margin:'1rem', maxHeight:'90vh', overflowY:'auto' },
  modalTitle:   { fontSize:22, fontWeight:600, color:'#222', marginBottom:4 },
  modalSub:     { fontSize:18, color:'#888', marginBottom:4 },
  field:        { display:'flex', flexDirection:'column', gap:5, marginBottom:'1rem' },
  label:        { fontSize:18, color:'#666' },
  input:        { padding:'9px 11px', border:'1px solid #ddd', borderRadius:8, fontSize:20, color:'#222' },
  modalBtns:    { display:'flex', gap:10, justifyContent:'flex-end' },
  cancelBtn:    { padding:'8px 16px', background:'none', border:'1px solid #ddd', borderRadius:8, cursor:'pointer', fontSize:18 },
  confirmBtn:   { padding:'8px 18px', background:'#085041', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:18, fontWeight:600 },
}
