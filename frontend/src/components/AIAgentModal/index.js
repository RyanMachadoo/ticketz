import React, { useEffect, useState } from "react";
import { toast } from "react-toastify";

import { makeStyles } from "@material-ui/core/styles";
import {
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Switch,
  TextField,
  Typography
} from "@material-ui/core";
import { AddCircleOutline, DeleteOutline } from "@material-ui/icons";

import api from "../../services/api";
import { i18n } from "../../translate/i18n";
import toastError from "../../errors/toastError";

const useStyles = makeStyles(theme => ({
  section: {
    marginTop: theme.spacing(2),
    marginBottom: theme.spacing(1)
  },
  toolCard: {
    padding: theme.spacing(1.5),
    marginBottom: theme.spacing(1.5)
  },
  fullWidth: { width: "100%" },
  paramRow: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    marginTop: 6
  },
  hint: { marginBottom: theme.spacing(1) }
}));

const emptyParam = () => ({
  name: "",
  type: "string",
  description: "",
  required: false
});

const emptyHeader = () => ({ key: "", value: "" });

const newTool = kind => {
  if (kind === "transfer") {
    return { kind: "transfer", description: "" };
  }
  if (kind === "webhook") {
    return {
      kind: "webhook",
      name: "",
      description: "",
      event: "agent.custom",
      parameters: []
    };
  }
  return {
    kind: "http",
    name: "",
    description: "",
    method: "GET",
    url: "",
    headers: [],
    bodyTemplate: "",
    parameters: []
  };
};

const defaultForm = {
  name: "",
  apiKey: "",
  model: "claude-3-5-sonnet-latest",
  maxTokens: 1024,
  temperature: 0.7,
  maxToolSteps: 5,
  isActive: true,
  systemPrompt: "",
  tools: [],
  queueIds: []
};

const AIAgentModal = ({ open, onClose, agentId }) => {
  const classes = useStyles();
  const [form, setForm] = useState(defaultForm);
  const [queues, setQueues] = useState([]);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(defaultForm);
    setHasApiKey(false);

    (async () => {
      try {
        const { data: queuesData } = await api.get("/queue");
        setQueues(Array.isArray(queuesData) ? queuesData : []);
      } catch (err) {
        toastError(err);
      }

      if (agentId) {
        try {
          const { data } = await api.get(`/ai-agents/${agentId}`);
          setHasApiKey(!!data.hasApiKey);
          setForm({
            name: data.name || "",
            apiKey: "",
            model: data.model || "claude-3-5-sonnet-latest",
            maxTokens: data.maxTokens || 1024,
            temperature:
              data.temperature !== undefined ? Number(data.temperature) : 0.7,
            maxToolSteps: data.maxToolSteps || 5,
            isActive: data.isActive !== undefined ? data.isActive : true,
            systemPrompt: data.systemPrompt || "",
            tools: Array.isArray(data.tools) ? data.tools : [],
            queueIds: Array.isArray(data.queueIds) ? data.queueIds : []
          });
        } catch (err) {
          toastError(err);
        }
      }
    })();
  }, [open, agentId]);

  const setField = (field, value) => setForm(f => ({ ...f, [field]: value }));

  // ---- tools helpers ----
  const addTool = kind =>
    setForm(f => ({ ...f, tools: [...f.tools, newTool(kind)] }));

  const removeTool = idx =>
    setForm(f => ({ ...f, tools: f.tools.filter((_, i) => i !== idx) }));

  const updateTool = (idx, patch) =>
    setForm(f => ({
      ...f,
      tools: f.tools.map((t, i) => (i === idx ? { ...t, ...patch } : t))
    }));

  const addParam = idx =>
    updateTool(idx, {
      parameters: [...(form.tools[idx].parameters || []), emptyParam()]
    });

  const updateParam = (idx, pIdx, patch) =>
    updateTool(idx, {
      parameters: (form.tools[idx].parameters || []).map((p, i) =>
        i === pIdx ? { ...p, ...patch } : p
      )
    });

  const removeParam = (idx, pIdx) =>
    updateTool(idx, {
      parameters: (form.tools[idx].parameters || []).filter(
        (_, i) => i !== pIdx
      )
    });

  const addHeader = idx =>
    updateTool(idx, {
      headers: [...(form.tools[idx].headers || []), emptyHeader()]
    });

  const updateHeader = (idx, hIdx, patch) =>
    updateTool(idx, {
      headers: (form.tools[idx].headers || []).map((h, i) =>
        i === hIdx ? { ...h, ...patch } : h
      )
    });

  const removeHeader = (idx, hIdx) =>
    updateTool(idx, {
      headers: (form.tools[idx].headers || []).filter((_, i) => i !== hIdx)
    });

  const handleSave = async () => {
    if (!form.name || form.name.trim().length < 2) {
      toast.error(i18n.t("aiAgents.modal.invalidName"));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        model: form.model,
        maxTokens: Number(form.maxTokens) || 1024,
        temperature: Number(form.temperature),
        maxToolSteps: Number(form.maxToolSteps) || 5,
        isActive: form.isActive,
        systemPrompt: form.systemPrompt,
        tools: form.tools,
        queueIds: form.queueIds
      };
      // Só envia a chave se o usuário digitou uma nova.
      if (form.apiKey && form.apiKey.trim()) {
        payload.apiKey = form.apiKey.trim();
      }

      if (agentId) {
        await api.put(`/ai-agents/${agentId}`, payload);
      } else {
        await api.post("/ai-agents", payload);
      }
      toast.success(i18n.t("aiAgents.toasts.saved"));
      onClose();
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  };

  const renderParams = (tool, idx) => (
    <div className={classes.section}>
      <Typography variant="caption" color="textSecondary">
        {i18n.t("aiAgents.modal.parameters")}
      </Typography>
      {(tool.parameters || []).map((p, pIdx) => (
        <div className={classes.paramRow} key={pIdx}>
          <TextField
            label={i18n.t("aiAgents.modal.paramName")}
            value={p.name}
            onChange={e => updateParam(idx, pIdx, { name: e.target.value })}
            margin="dense"
          />
          <FormControl margin="dense" style={{ minWidth: 110 }}>
            <InputLabel>{i18n.t("aiAgents.modal.paramType")}</InputLabel>
            <Select
              value={p.type}
              onChange={e => updateParam(idx, pIdx, { type: e.target.value })}
            >
              <MenuItem value="string">string</MenuItem>
              <MenuItem value="number">number</MenuItem>
              <MenuItem value="boolean">boolean</MenuItem>
            </Select>
          </FormControl>
          <TextField
            label={i18n.t("aiAgents.modal.paramDesc")}
            value={p.description}
            onChange={e =>
              updateParam(idx, pIdx, { description: e.target.value })
            }
            margin="dense"
            style={{ flex: 1 }}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={!!p.required}
                onChange={e =>
                  updateParam(idx, pIdx, { required: e.target.checked })
                }
              />
            }
            label={i18n.t("aiAgents.modal.paramRequired")}
          />
          <IconButton size="small" onClick={() => removeParam(idx, pIdx)}>
            <DeleteOutline fontSize="small" />
          </IconButton>
        </div>
      ))}
      <Button
        size="small"
        startIcon={<AddCircleOutline />}
        onClick={() => addParam(idx)}
      >
        {i18n.t("aiAgents.modal.addParam")}
      </Button>
    </div>
  );

  const renderTool = (tool, idx) => (
    <Paper variant="outlined" className={classes.toolCard} key={idx}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}
      >
        <Chip
          size="small"
          color="primary"
          label={i18n.t(`aiAgents.modal.kind.${tool.kind}`)}
        />
        <IconButton size="small" onClick={() => removeTool(idx)}>
          <DeleteOutline fontSize="small" />
        </IconButton>
      </div>

      {tool.kind !== "transfer" && (
        <TextField
          label={i18n.t("aiAgents.modal.toolName")}
          helperText={i18n.t("aiAgents.modal.toolNameHint")}
          value={tool.name || ""}
          onChange={e => updateTool(idx, { name: e.target.value })}
          fullWidth
          margin="dense"
        />
      )}

      <TextField
        label={i18n.t("aiAgents.modal.toolDesc")}
        helperText={i18n.t("aiAgents.modal.toolDescHint")}
        value={tool.description || ""}
        onChange={e => updateTool(idx, { description: e.target.value })}
        fullWidth
        margin="dense"
        multiline
      />

      {tool.kind === "webhook" && (
        <TextField
          label={i18n.t("aiAgents.modal.event")}
          value={tool.event || ""}
          onChange={e => updateTool(idx, { event: e.target.value })}
          fullWidth
          margin="dense"
        />
      )}

      {tool.kind === "http" && (
        <>
          <Grid container spacing={1}>
            <Grid item xs={3}>
              <FormControl margin="dense" fullWidth>
                <InputLabel>{i18n.t("aiAgents.modal.method")}</InputLabel>
                <Select
                  value={tool.method || "GET"}
                  onChange={e => updateTool(idx, { method: e.target.value })}
                >
                  {["GET", "POST", "PUT", "PATCH", "DELETE"].map(m => (
                    <MenuItem key={m} value={m}>
                      {m}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={9}>
              <TextField
                label={i18n.t("aiAgents.modal.url")}
                helperText={i18n.t("aiAgents.modal.urlHint")}
                value={tool.url || ""}
                onChange={e => updateTool(idx, { url: e.target.value })}
                fullWidth
                margin="dense"
              />
            </Grid>
          </Grid>

          <Typography variant="caption" color="textSecondary">
            {i18n.t("aiAgents.modal.headers")}
          </Typography>
          {(tool.headers || []).map((h, hIdx) => (
            <div className={classes.paramRow} key={hIdx}>
              <TextField
                label="Header"
                value={h.key}
                onChange={e => updateHeader(idx, hIdx, { key: e.target.value })}
                margin="dense"
              />
              <TextField
                label="Valor"
                value={h.value}
                onChange={e =>
                  updateHeader(idx, hIdx, { value: e.target.value })
                }
                margin="dense"
                style={{ flex: 1 }}
              />
              <IconButton size="small" onClick={() => removeHeader(idx, hIdx)}>
                <DeleteOutline fontSize="small" />
              </IconButton>
            </div>
          ))}
          <Button
            size="small"
            startIcon={<AddCircleOutline />}
            onClick={() => addHeader(idx)}
          >
            {i18n.t("aiAgents.modal.addHeader")}
          </Button>

          <TextField
            label={i18n.t("aiAgents.modal.bodyTemplate")}
            helperText={i18n.t("aiAgents.modal.bodyTemplateHint")}
            value={tool.bodyTemplate || ""}
            onChange={e => updateTool(idx, { bodyTemplate: e.target.value })}
            fullWidth
            margin="dense"
            multiline
            minRows={2}
          />
        </>
      )}

      {tool.kind !== "transfer" && renderParams(tool, idx)}
    </Paper>
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth scroll="paper">
      <DialogTitle>
        {agentId
          ? i18n.t("aiAgents.modal.editTitle")
          : i18n.t("aiAgents.modal.addTitle")}
      </DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField
              label={i18n.t("aiAgents.modal.name")}
              value={form.name}
              onChange={e => setField("name", e.target.value)}
              fullWidth
              margin="dense"
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label={i18n.t("aiAgents.modal.model")}
              helperText={i18n.t("aiAgents.modal.modelHint")}
              value={form.model}
              onChange={e => setField("model", e.target.value)}
              fullWidth
              margin="dense"
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              label={i18n.t("aiAgents.modal.apiKey")}
              helperText={
                hasApiKey
                  ? i18n.t("aiAgents.modal.apiKeyKeep")
                  : i18n.t("aiAgents.modal.apiKeyHint")
              }
              value={form.apiKey}
              onChange={e => setField("apiKey", e.target.value)}
              fullWidth
              margin="dense"
              type="password"
              placeholder={hasApiKey ? "••••••••" : ""}
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField
              label={i18n.t("aiAgents.modal.maxTokens")}
              type="number"
              value={form.maxTokens}
              onChange={e => setField("maxTokens", e.target.value)}
              fullWidth
              margin="dense"
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField
              label={i18n.t("aiAgents.modal.temperature")}
              type="number"
              inputProps={{ step: 0.1, min: 0, max: 1 }}
              value={form.temperature}
              onChange={e => setField("temperature", e.target.value)}
              fullWidth
              margin="dense"
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField
              label={i18n.t("aiAgents.modal.maxToolSteps")}
              type="number"
              value={form.maxToolSteps}
              onChange={e => setField("maxToolSteps", e.target.value)}
              fullWidth
              margin="dense"
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <FormControlLabel
              control={
                <Switch
                  checked={!!form.isActive}
                  onChange={e => setField("isActive", e.target.checked)}
                  color="primary"
                />
              }
              label={i18n.t("aiAgents.modal.active")}
            />
          </Grid>

          <Grid item xs={12}>
            <FormControl fullWidth margin="dense">
              <InputLabel>{i18n.t("aiAgents.modal.queues")}</InputLabel>
              <Select
                multiple
                value={form.queueIds}
                onChange={e => setField("queueIds", e.target.value)}
                renderValue={selected =>
                  queues
                    .filter(q => selected.includes(q.id))
                    .map(q => q.name)
                    .join(", ")
                }
              >
                {queues.map(q => (
                  <MenuItem key={q.id} value={q.id}>
                    <Checkbox checked={form.queueIds.indexOf(q.id) > -1} />
                    {q.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Typography variant="caption" color="textSecondary">
              {i18n.t("aiAgents.modal.queuesHint")}
            </Typography>
          </Grid>

          <Grid item xs={12}>
            <TextField
              label={i18n.t("aiAgents.modal.systemPrompt")}
              helperText={i18n.t("aiAgents.modal.systemPromptHint")}
              value={form.systemPrompt}
              onChange={e => setField("systemPrompt", e.target.value)}
              fullWidth
              margin="dense"
              multiline
              minRows={5}
            />
          </Grid>
        </Grid>

        <Divider className={classes.section} />
        <Typography variant="subtitle1">
          {i18n.t("aiAgents.modal.toolsTitle")}
        </Typography>
        <Typography
          variant="body2"
          color="textSecondary"
          className={classes.hint}
        >
          {i18n.t("aiAgents.modal.toolsHint")}
        </Typography>

        {form.tools.map((tool, idx) => renderTool(tool, idx))}

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<AddCircleOutline />}
            onClick={() => addTool("http")}
          >
            {i18n.t("aiAgents.modal.addHttp")}
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<AddCircleOutline />}
            onClick={() => addTool("webhook")}
          >
            {i18n.t("aiAgents.modal.addWebhook")}
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<AddCircleOutline />}
            onClick={() => addTool("transfer")}
          >
            {i18n.t("aiAgents.modal.addTransfer")}
          </Button>
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="secondary" disabled={saving}>
          {i18n.t("aiAgents.modal.cancel")}
        </Button>
        <Button
          onClick={handleSave}
          color="primary"
          variant="contained"
          disabled={saving}
        >
          {i18n.t("aiAgents.modal.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AIAgentModal;
