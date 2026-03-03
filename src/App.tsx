import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Checkbox,
  Col,
  ConfigProvider,
  Input,
  Modal,
  Menu,
  Progress,
  Result,
  Row,
  Select,
  Space,
  Spin,
  Steps,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd'
import {
  CheckCircleOutlined,
  MessageOutlined,
  SettingOutlined,
  WechatWorkOutlined,
} from '@ant-design/icons'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import './App.css'

type View =
  | 'installer-start'
  | 'installer-path'
  | 'installer-installing'
  | 'installer-done'
  | 'boot-check'
  | 'ai-setup'
  | 'init-done'
  | 'home'
  | 'chat'
  | 'channels'
  | 'settings'
  | 'uninstalling'
  | 'uninstall-done'

const providers = [
  'Kimi',
  'DeepSeek',
  'Moonshot',
  'Qwen',
  'GLM',
  'MiniMax',
  'OpenAI',
  'Anthropic',
  '自定义(兼容 OpenAI)',
]

const models: Record<string, string[]> = {
  Kimi: ['kimi-k2-0711-preview', 'moonshot-v1-8k', 'moonshot-v1-32k'],
  DeepSeek: ['deepseek-chat', 'deepseek-reasoner'],
  Moonshot: ['moonshot-v1-8k', 'moonshot-v1-32k'],
  Qwen: ['qwen-max', 'qwen-plus'],
  GLM: ['glm-4.5', 'glm-4-air'],
  MiniMax: ['minimax-m1', 'minimax-chat'],
  OpenAI: ['gpt-5.1-codex', 'gpt-5.2'],
  Anthropic: ['claude-sonnet-4-5', 'claude-opus-4-6'],
  '自定义(兼容 OpenAI)': ['custom-model-id'],
}

const { Title, Text, Paragraph } = Typography

type HomeSelection = 'chat' | 'channels' | 'ai' | 'settings'

type PersistedState = {
  installPath?: string | null
  aiSettings?: {
    provider: string
    apiKey: string
    model: string
  } | null
  autoStart?: boolean | null
  autoUpdate?: boolean | null
}

type TaskProgressEvent = {
  task: 'install' | 'uninstall'
  progress: number
  message: string
}

type TaskDoneEvent = {
  task: 'install' | 'uninstall'
  success: boolean
  code?: string
  message: string
}

type UninstallPreview = {
  installPath: string
  appStateFile: string
  removeInstallFiles: string[]
  removeIfDeleteData: string[]
}

const isTauriRuntime = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as unknown as Record<string, unknown>)

function App() {
  const [view, setView] = useState<View>('installer-start')
  const [installPath, setInstallPath] = useState('C:\\Program Files\\OpenClaw')
  const [installProgress, setInstallProgress] = useState(0)
  const [bootProgress, setBootProgress] = useState(0)
  const [showAdminModal, setShowAdminModal] = useState(false)
  const [nextAction, setNextAction] = useState<'install' | 'uninstall' | null>(null)
  const [provider, setProvider] = useState('Kimi')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(models.Kimi[0])
  const [testing, setTesting] = useState(false)
  const [saveLoading, setSaveLoading] = useState(false)
  const [deleteData, setDeleteData] = useState(false)
  const [autoStart, setAutoStart] = useState(true)
  const [autoUpdate, setAutoUpdate] = useState(false)
  const [showUninstallModal, setShowUninstallModal] = useState(false)
  const [homeSelection, setHomeSelection] = useState<HomeSelection>('chat')
  const [taskMessage, setTaskMessage] = useState('')
  const [uninstallPreview, setUninstallPreview] = useState<UninstallPreview | null>(null)
  const [uninstallBlockers, setUninstallBlockers] = useState<string[]>([])
  const [messageApi, contextHolder] = message.useMessage()

  const tauriInvoke = async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
    if (!isTauriRuntime()) {
      throw new Error('当前不是桌面运行环境，请使用 tauri:dev 启动')
    }
    return invoke<T>(command, args)
  }

  const installerStep = useMemo(() => {
    if (view === 'installer-start') return 0
    if (view === 'installer-path') return 1
    if (view === 'installer-installing') return 2
    return 3
  }, [view])

  const requiresAdmin = (path: string) => path.startsWith('C:\\Program Files')

  useEffect(() => {
    if (view !== 'boot-check') return
    const timer = setInterval(() => {
      setBootProgress((prev) => {
        const next = Math.min(prev + 12, 100)
        if (next === 100) {
          clearInterval(timer)
          setTimeout(() => setView('ai-setup'), 350)
        }
        return next
      })
    }, 220)
    return () => clearInterval(timer)
  }, [view])

  const startInstall = async () => {
    if (!installPath.trim()) {
      messageApi.error('请先选择安装位置')
      return
    }
    if (requiresAdmin(installPath)) {
      setNextAction('install')
      setShowAdminModal(true)
      return
    }

    setInstallProgress(0)
    setTaskMessage('正在准备安装环境')
    setView('installer-installing')

    try {
      await tauriInvoke('start_install_task', { installPath })
    } catch (error) {
      messageApi.error(`安装准备失败：${String(error)}`)
      setView('installer-path')
      return
    }

    setView('installer-installing')
  }

  const chooseInstallPath = async () => {
    try {
      const selected = await tauriInvoke<string | null>('pick_install_directory')
      if (selected) {
        setInstallPath(selected)
      }
    } catch (error) {
      messageApi.error(`无法打开目录选择器：${String(error)}`)
    }
  }

  const enterBootCheck = () => {
    setBootProgress(0)
    setView('boot-check')
  }

  const confirmAdmin = async () => {
    setShowAdminModal(false)
    if (nextAction === 'install') {
      try {
        setInstallProgress(0)
        setTaskMessage('正在准备安装环境')
        setView('installer-installing')
        await tauriInvoke('start_install_task', { installPath })
      } catch (error) {
        messageApi.error(`安装准备失败：${String(error)}`)
        setNextAction(null)
        return
      }
    }
    if (nextAction === 'uninstall') {
      try {
        setInstallProgress(0)
        setTaskMessage('正在停止相关服务')
        setView('uninstalling')
        await tauriInvoke('start_uninstall_task', {
          installPath,
          deleteData,
        })
      } catch (error) {
        messageApi.error(`卸载失败：${String(error)}`)
        setNextAction(null)
        return
      }
    }
    setNextAction(null)
  }

  const testConnection = async () => {
    if (!apiKey.trim()) {
      messageApi.error('请先填写 API Key')
      return
    }
    setTesting(true)
    try {
      const result = await tauriInvoke<string>('test_ai_connection', {
        provider,
        apiKey,
        model,
      })
      messageApi.success(result || '连接成功，可以开始使用')
    } catch (error) {
      messageApi.error(`连接失败：${String(error)}`)
    }
    setTesting(false)
  }

  const saveAiSettings = async () => {
    if (!provider || !model || !apiKey.trim()) {
      messageApi.error('请完成必填项后再保存')
      return
    }
    setSaveLoading(true)
    try {
      await tauriInvoke('save_ai_settings', {
        settings: {
          provider,
          apiKey,
          model,
        },
      })
    } catch (error) {
      setSaveLoading(false)
      messageApi.error(`保存失败：${String(error)}`)
      return
    }
    setSaveLoading(false)
    setView('init-done')
  }

  const saveAiSettingsInline = async () => {
    if (!provider || !model || !apiKey.trim()) {
      messageApi.error('请完成必填项后再保存')
      return
    }
    setSaveLoading(true)
    try {
      await tauriInvoke('save_ai_settings', {
        settings: {
          provider,
          apiKey,
          model,
        },
      })
    } catch (error) {
      setSaveLoading(false)
      messageApi.error(`保存失败：${String(error)}`)
      return
    }
    setSaveLoading(false)
    messageApi.success('AI 设置已保存')
  }

  const startUninstall = async () => {
    if (uninstallBlockers.length > 0) {
      messageApi.error('检测到程序仍在占用，请先关闭相关进程后再卸载')
      return
    }

    setShowUninstallModal(false)
    if (requiresAdmin(installPath)) {
      setNextAction('uninstall')
      setShowAdminModal(true)
      return
    }

    try {
      setInstallProgress(0)
      setTaskMessage('正在停止相关服务')
      setView('uninstalling')
      await tauriInvoke('start_uninstall_task', {
        installPath,
        deleteData,
      })
    } catch (error) {
      messageApi.error(`卸载失败：${String(error)}`)
      setView('home')
      return
    }
  }

  const openUninstallModal = async () => {
    setShowUninstallModal(true)
    if (!isTauriRuntime()) {
      setUninstallPreview(null)
      setUninstallBlockers([])
      return
    }
    try {
      const preview = await tauriInvoke<UninstallPreview>('get_uninstall_preview', {
        installPath,
      })
      setUninstallPreview(preview)

      const blockers = await tauriInvoke<string[]>('get_uninstall_blockers', {
        installPath,
      })
      setUninstallBlockers(blockers)
    } catch {
      setUninstallPreview(null)
      setUninstallBlockers([])
    }
  }

  const modelOptions = models[provider] || []

  useEffect(() => {
    if (!isTauriRuntime()) {
      return
    }

    let unlistenProgress: (() => void) | undefined
    let unlistenDone: (() => void) | undefined

    const bindEvents = async () => {
      unlistenProgress = await listen<TaskProgressEvent>('task-progress', (event) => {
        const payload = event.payload
        setInstallProgress(payload.progress)
        setTaskMessage(payload.message)
      })

      unlistenDone = await listen<TaskDoneEvent>('task-done', (event) => {
        const payload = event.payload
        if (payload.task === 'install') {
          if (payload.success) {
            setView('installer-done')
          } else {
            messageApi.error(payload.code ? `${payload.message || '安装失败'}（${payload.code}）` : payload.message || '安装失败')
            setView('installer-path')
          }
        }

        if (payload.task === 'uninstall') {
          if (payload.success) {
            setView('uninstall-done')
          } else {
            messageApi.error(payload.code ? `${payload.message || '卸载失败'}（${payload.code}）` : payload.message || '卸载失败')
            setView('home')
          }
        }
      })
    }

    void bindEvents()

    return () => {
      if (unlistenProgress) {
        unlistenProgress()
      }
      if (unlistenDone) {
        unlistenDone()
      }
    }
  }, [messageApi])

  const cancelTask = async (task: 'install' | 'uninstall') => {
    try {
      await tauriInvoke('cancel_task', { task })
      messageApi.info(task === 'install' ? '正在取消安装...' : '正在取消卸载...')
    } catch (error) {
      messageApi.error(`取消失败：${String(error)}`)
    }
  }

  useEffect(() => {
    const loadPersistedState = async () => {
      if (!isTauriRuntime()) {
        return
      }

      try {
        const state = await tauriInvoke<PersistedState>('load_state')
        if (state.installPath) {
          setInstallPath(state.installPath)
        }
        if (state.aiSettings) {
          setProvider(state.aiSettings.provider)
          setApiKey(state.aiSettings.apiKey)
          setModel(state.aiSettings.model)
        }
        if (typeof state.autoStart === 'boolean') {
          setAutoStart(state.autoStart)
        }
        if (typeof state.autoUpdate === 'boolean') {
          setAutoUpdate(state.autoUpdate)
        }
      } catch (error) {
        messageApi.warning(`读取本地配置失败：${String(error)}`)
      }
    }

    void loadPersistedState()
  }, [messageApi])

  const updatePreferences = async (nextAutoStart: boolean, nextAutoUpdate: boolean) => {
    setAutoStart(nextAutoStart)
    setAutoUpdate(nextAutoUpdate)
    try {
      await tauriInvoke('save_preferences', {
        autoStart: nextAutoStart,
        autoUpdate: nextAutoUpdate,
      })
    } catch (error) {
      messageApi.error(`保存设置失败：${String(error)}`)
    }
  }

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#1f6feb',
          borderRadius: 12,
          fontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        },
      }}
    >
      <AntdApp>
        {contextHolder}
        <div className="app-bg">
          <div className="shell">
            {(view.startsWith('installer') || view === 'uninstalling' || view === 'uninstall-done') && (
              <Steps
                current={installerStep}
                items={[
                  { title: '开始' },
                  { title: '安装位置' },
                  { title: '安装中' },
                  { title: '完成' },
                ]}
                className="top-steps"
              />
            )}

            <AnimatePresence mode="wait">
              <motion.div
                key={view}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22 }}
              >
                <Card className="main-card" bordered={false}>
                      {view === 'installer-start' && (
                        <Space direction="vertical" size={20} className="full-width">
                          <Title level={3} style={{ margin: 0 }}>
                            快速完成 OpenClaw 安装
                          </Title>
                          <Tag color="blue">OpenClaw 一键安装</Tag>
                          <Text type="secondary">预计 3 分钟完成安装，全程无需命令行。</Text>
                          <Row gutter={[12, 12]}>
                            <Col span={12}>
                              <Card size="small" className="feature-card">
                                <Text strong>全自动环境准备</Text>
                                <br />
                                <Text type="secondary">按需系统授权，自动处理依赖</Text>
                              </Card>
                            </Col>
                            <Col span={12}>
                              <Card size="small" className="feature-card">
                                <Text strong>首次引导可直达聊天</Text>
                                <br />
                                <Text type="secondary">完成 AI 设置即可进入控制台</Text>
                              </Card>
                            </Col>
                          </Row>
                          <Space>
                            <Button type="primary" size="large" onClick={() => setView('installer-path')}>
                              立即安装
                            </Button>
                            <Button onClick={() => messageApi.info('已退出安装流程（演示）')}>退出</Button>
                          </Space>
                        </Space>
                      )}

                      {view === 'installer-path' && (
                        <Space direction="vertical" size={18} className="full-width">
                          <Title level={3} style={{ margin: 0 }}>
                            选择安装位置
                          </Title>
                          <Input
                            size="large"
                            value={installPath}
                            onChange={(e) => setInstallPath(e.target.value)}
                            addonAfter={<Button type="link" onClick={() => void chooseInstallPath()}>更改...</Button>}
                          />
                          <Alert type="info" showIcon message="建议使用默认位置，后续升级会更稳定。" />
                          <Space>
                            <Button onClick={() => setView('installer-start')}>上一步</Button>
                            <Button type="primary" onClick={() => void startInstall()}>
                              开始安装
                            </Button>
                          </Space>
                        </Space>
                      )}

                      {view === 'installer-installing' && (
                        <Space direction="vertical" size={18} className="full-width">
                          <Title level={3} style={{ margin: 0 }}>
                            正在安装 OpenClaw
                          </Title>
                          <Progress percent={installProgress} status="active" strokeWidth={14} />
                          <Text type="secondary">预计剩余：约 1 分钟</Text>
                          <Card size="small" className="feature-card">
                            <Text>{taskMessage || '安装内容正在后台自动处理，请保持窗口开启。'}</Text>
                          </Card>
                          <Button onClick={() => void cancelTask('install')}>取消安装</Button>
                        </Space>
                      )}

                      {view === 'installer-done' && (
                        <Result
                          status="success"
                          title="安装完成"
                          subTitle="OpenClaw 已准备就绪。"
                          extra={[
                            <Button key="open" type="primary" onClick={enterBootCheck}>
                              立即打开 OpenClaw
                            </Button>,
                            <Button key="later">稍后再说</Button>,
                          ]}
                        />
                      )}

                      {view === 'boot-check' && (
                        <Space direction="vertical" size={16} className="full-width">
                          <Title level={3} style={{ margin: 0 }}>
                            启动检查
                          </Title>
                          <Progress percent={bootProgress} status="active" strokeWidth={14} />
                          <Steps
                            size="small"
                            direction="vertical"
                            current={bootProgress < 34 ? 0 : bootProgress < 67 ? 1 : 2}
                            items={[
                              { title: '服务已就绪' },
                              { title: '运行环境正常' },
                              { title: '本地连接正常' },
                            ]}
                          />
                        </Space>
                      )}

                      {view === 'ai-setup' && (
                        <Space direction="vertical" size={14} className="full-width">
                          <Title level={3} style={{ margin: 0 }}>
                            AI 设置（首次使用必填）
                          </Title>
                          <Text>选择 AI 平台</Text>
                          <Select
                            size="large"
                            value={provider}
                            onChange={(nextProvider) => {
                              setProvider(nextProvider)
                              setModel((models[nextProvider] || [])[0])
                            }}
                            options={providers.map((p) => ({ label: p, value: p }))}
                          />
                          <Text>API Key</Text>
                          <Input.Password size="large" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="请输入 API Key" />
                          <Text>默认模型</Text>
                          <Select size="large" value={model} onChange={setModel} options={modelOptions.map((m) => ({ label: m, value: m }))} />
                          {provider === '自定义(兼容 OpenAI)' && (
                            <Alert type="info" showIcon message="自定义模式需在后端补充 Base URL 与模型标识。" />
                          )}
                          <Space>
                            <Button loading={testing} onClick={testConnection}>
                              测试连接
                            </Button>
                            <Button type="primary" loading={saveLoading} onClick={() => void saveAiSettings()}>
                              保存并开始使用
                            </Button>
                          </Space>
                        </Space>
                      )}

                      {view === 'init-done' && (
                        <Result
                          status="success"
                          title="初始化完成"
                          subTitle="已保存 AI 设置，可以开始使用。"
                          extra={
                            <Button
                              type="primary"
                              onClick={() => {
                                setHomeSelection('chat')
                                setView('home')
                              }}
                            >
                              进入控制台
                            </Button>
                          }
                        />
                      )}

                      {view === 'home' && (
                        <Space direction="vertical" size={20} className="full-width">
                          <Space className="full-width between" align="center">
                            <Title level={3} style={{ margin: 0 }}>
                              OpenClaw 控制台
                            </Title>
                            <Space size={8} wrap>
                              <Tag color="green">服务正常</Tag>
                              <Tag>{provider}</Tag>
                              <Tag>{model}</Tag>
                            </Space>
                          </Space>
                          <Row gutter={[14, 14]}>
                            <Col xs={24} md={8}>
                              <Card className="menu-card">
                                <Menu
                                  mode="inline"
                                  selectedKeys={[homeSelection]}
                                  onClick={(e) => setHomeSelection(e.key as 'chat' | 'channels' | 'ai' | 'settings')}
                                  items={[
                                    { key: 'chat', icon: <MessageOutlined />, label: '开始聊天（推荐）' },
                                    { key: 'channels', icon: <WechatWorkOutlined />, label: '连接聊天渠道' },
                                    { key: 'ai', icon: <CheckCircleOutlined />, label: 'AI 设置' },
                                    { key: 'settings', icon: <SettingOutlined />, label: '设置' },
                                  ]}
                                />
                              </Card>
                            </Col>
                            <Col xs={24} md={16}>
                              <Card className="nav-card">
                                {homeSelection === 'chat' && (
                                  <Space direction="vertical" size={12} className="full-width">
                                    <Title level={4} style={{ margin: 0 }}>
                                      聊天工作区
                                    </Title>
                                    <Card className="chat-card">
                                      <Space direction="vertical" size={10} className="full-width">
                                        <div className="bubble bubble-agent">你好，我是 OpenClaw。需要我先帮你做什么？</div>
                                        <div className="bubble bubble-user">帮我写一份项目周报。</div>
                                        <div className="bubble bubble-agent">好的，我先给你一个周报结构模板。</div>
                                      </Space>
                                    </Card>
                                    <Input.Search placeholder="输入你的问题..." enterButton="发送" size="large" />
                                  </Space>
                                )}

                                {homeSelection === 'channels' && (
                                  <Space direction="vertical" size={12} className="full-width">
                                    <Title level={4} style={{ margin: 0 }}>
                                      连接聊天渠道
                                    </Title>
                                    <Card className="channel-card">WhatsApp <Button type="link">去连接</Button></Card>
                                    <Card className="channel-card">Telegram <Button type="link">去连接</Button></Card>
                                    <Card className="channel-card">Discord <Button type="link">去连接</Button></Card>
                                    <Text type="secondary">不连接渠道也可以直接在控制台聊天。</Text>
                                  </Space>
                                )}

                                {homeSelection === 'ai' && (
                                  <Space direction="vertical" size={12} className="full-width">
                                    <Title level={4} style={{ margin: 0 }}>
                                      AI 设置
                                    </Title>
                                    <Text>选择 AI 平台</Text>
                                    <Select
                                      size="large"
                                      value={provider}
                                      onChange={(nextProvider) => {
                                        setProvider(nextProvider)
                                        setModel((models[nextProvider] || [])[0])
                                      }}
                                      options={providers.map((p) => ({ label: p, value: p }))}
                                    />
                                    <Text>API Key</Text>
                                    <Input.Password size="large" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="请输入 API Key" />
                                    <Text>默认模型</Text>
                                    <Select size="large" value={model} onChange={setModel} options={modelOptions.map((m) => ({ label: m, value: m }))} />
                                    <Space>
                                      <Button loading={testing} onClick={testConnection}>
                                        测试连接
                                      </Button>
                                      <Button type="primary" loading={saveLoading} onClick={() => void saveAiSettingsInline()}>
                                        保存设置
                                      </Button>
                                    </Space>
                                  </Space>
                                )}

                                {homeSelection === 'settings' && (
                                  <Space direction="vertical" size={12} className="full-width">
                                    <Title level={4} style={{ margin: 0 }}>
                                      设置
                                    </Title>
                                    <Card>
                                      <Space className="full-width between">
                                        <Text>开机自动启动 OpenClaw</Text>
                                        <Switch checked={autoStart} onChange={(checked) => void updatePreferences(checked, autoUpdate)} />
                                      </Space>
                                    </Card>
                                    <Card>
                                      <Space className="full-width between">
                                        <Text>自动检查更新</Text>
                                        <Switch checked={autoUpdate} onChange={(checked) => void updatePreferences(autoStart, checked)} />
                                      </Space>
                                    </Card>
                                    <Card>
                                      <Space className="full-width between">
                                        <Text>AI 设置</Text>
                                        <Button onClick={() => setHomeSelection('ai')}>修改</Button>
                                      </Space>
                                    </Card>
                                    <Card className="danger-card">
                                      <Space direction="vertical" className="full-width" size={8}>
                                        <Text strong>卸载</Text>
                                        <Text type="secondary">从本机移除 OpenClaw。</Text>
                                        <Button danger onClick={() => void openUninstallModal()}>
                                          卸载 OpenClaw
                                        </Button>
                                      </Space>
                                    </Card>
                                  </Space>
                                )}
                              </Card>
                            </Col>
                          </Row>
                        </Space>
                      )}

                      {view === 'uninstalling' && (
                        <Space direction="vertical" size={16} className="full-width">
                          <Title level={3} style={{ margin: 0 }}>
                            正在卸载 OpenClaw
                          </Title>
                          <Progress percent={installProgress} status="active" strokeWidth={14} />
                          <Text type="secondary">{taskMessage || '正在移除程序组件'}</Text>
                          <Spin tip="后台处理中" />
                          <Button onClick={() => void cancelTask('uninstall')}>取消卸载</Button>
                        </Space>
                      )}

                      {view === 'uninstall-done' && (
                        <Result
                          status="success"
                          title="已完成卸载"
                          subTitle={deleteData ? '程序与本地数据已移除。' : '程序已移除，本地聊天记录与配置已保留。'}
                          extra={
                            <Button type="primary" onClick={() => setView('installer-start')}>
                              完成
                            </Button>
                          }
                        />
                      )}
                </Card>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        <Modal
          open={showAdminModal}
          title="需要系统授权"
          onOk={() => void confirmAdmin()}
          onCancel={() => {
            setShowAdminModal(false)
            setNextAction(null)
          }}
          okText="我知道了"
          cancelText="取消"
        >
          <Paragraph style={{ marginBottom: 0 }}>
            当前操作需要管理员权限，请在系统弹窗中点击“是”。
          </Paragraph>
        </Modal>

        <Modal
          open={showUninstallModal}
          title="卸载 OpenClaw"
          onOk={() => void startUninstall()}
          onCancel={() => setShowUninstallModal(false)}
          okText="确认卸载"
          cancelText="取消"
          okButtonProps={{ disabled: uninstallBlockers.length > 0 }}
        >
          <Space direction="vertical" size={12}>
            <Text>你确定要卸载 OpenClaw 吗？</Text>
            {uninstallPreview && (
              <Card size="small">
                <Space direction="vertical" size={4} className="full-width">
                  <Text strong>将删除（默认）</Text>
                  {uninstallPreview.removeInstallFiles.map((item) => (
                    <Text key={item} type="secondary">
                      - {item}
                    </Text>
                  ))}
                  <Text strong style={{ marginTop: 6 }}>
                    勾选“删除本地数据”后还会删除
                  </Text>
                  {uninstallPreview.removeIfDeleteData.map((item) => (
                    <Text key={item} type="secondary">
                      - {item}
                    </Text>
                  ))}
                </Space>
              </Card>
            )}
            {uninstallBlockers.length > 0 && (
              <Alert
                type="warning"
                showIcon
                message="检测到以下进程正在占用安装目录，请先关闭后再卸载"
                description={
                  <Space direction="vertical" size={2}>
                    {uninstallBlockers.map((item) => (
                      <Text key={item} type="secondary">
                        - {item}
                      </Text>
                    ))}
                  </Space>
                }
              />
            )}
            <Checkbox checked={deleteData} onChange={(e) => setDeleteData(e.target.checked)}>
              同时删除本地聊天记录与配置文件（不可恢复）
            </Checkbox>
          </Space>
        </Modal>
      </AntdApp>
    </ConfigProvider>
  )
}

export default App
